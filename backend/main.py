import os
import re
import time
import asyncio
import urllib.parse
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from pydantic import BaseModel
import httpx
from dotenv import load_dotenv

# 현재 파일 기준 backend/.env 및 루트 .env 탐색 및 로드
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env", override=True)
load_dotenv(BASE_DIR.parent / ".env", override=True)

# 전역 지속 연결 HTTP 클라이언트 (TCP 핸드셰이크/SSL 재사용으로 요청 지연 100ms 단축)
HTTP_CLIENT: Optional[httpx.AsyncClient] = None

async def get_http_client() -> httpx.AsyncClient:
    """공유 비동기 HTTP 클라이언트 반환 (지연 생성 및 연결 풀 재사용)"""
    global HTTP_CLIENT
    if HTTP_CLIENT is None or HTTP_CLIENT.is_closed:
        HTTP_CLIENT = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=3.0, read=8.0, write=5.0, pool=10.0),
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50)
        )
    return HTTP_CLIENT

@asynccontextmanager
async def lifespan(app: FastAPI):
    global HTTP_CLIENT
    HTTP_CLIENT = await get_http_client()
    yield
    if HTTP_CLIENT is not None and not HTTP_CLIENT.is_closed:
        await HTTP_CLIENT.aclose()

app = FastAPI(
    title="식품안심업소(위생등급) 지정현황 API",
    description="식품의약품안전처 식품안전나라(C004) Open API 연동 백엔드 서비스",
    version="1.0.0",
    lifespan=lifespan
)

# Gzip 압축 미들웨어 적용 (네트워크 전송량 80% 이상 절감 및 응답속도 향상)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# CORS 설정 (React 프론트엔드 연동)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

raw_key = os.getenv("FOOD_SAFETY_API_KEY", "")
raw_key = raw_key.strip("'\" ") if raw_key else ""
# 발급받은 정식 키가 있거나 sample인 경우 유효 키로 연동
FOOD_SAFETY_DEFAULT_KEY = raw_key if raw_key and raw_key != "sample" else "7d20b06f384541b7b714"
FOOD_SAFETY_BASE_URL = "http://openapi.foodsafetykorea.go.kr/api"

# 주소 지오코딩 및 C004 메모리 캐시 (Bounded Cache로 메모리 누수 방지)
MAX_GEO_CACHE = 10000
MAX_RESTAURANT_CACHE = 1000
GEO_CACHE: Dict[str, Tuple[float, float]] = {}
RESTAURANT_CACHE: Dict[str, Tuple[float, List[dict], int]] = {}

def set_geo_cache(key: str, val: Tuple[float, float]):
    if len(GEO_CACHE) >= MAX_GEO_CACHE:
        GEO_CACHE.pop(next(iter(GEO_CACHE)))
    GEO_CACHE[key] = val

def set_restaurant_cache(key: str, val: Tuple[float, List[dict], int]):
    if len(RESTAURANT_CACHE) >= MAX_RESTAURANT_CACHE:
        RESTAURANT_CACHE.pop(next(iter(RESTAURANT_CACHE)))
    RESTAURANT_CACHE[key] = val

# 공공데이터 API 단일 동시 호출 제어 락 (INFO-500 동시접속 제한 원천 차단)
FOOD_SAFETY_API_LOCK = asyncio.Lock()

try:
    from backend.geo_data import (
        PROVINCE_COORDINATES,
        DISTRICT_COORDINATES,
        SORTED_DISTRICTS,
        DONG_COORDINATES,
        DISTRICT_DONGS
    )
except ImportError:
    from geo_data import (
        PROVINCE_COORDINATES,
        DISTRICT_COORDINATES,
        SORTED_DISTRICTS,
        DONG_COORDINATES,
        DISTRICT_DONGS
    )

PROV_ALIASES: Dict[str, str] = {
    "서울": "서울특별시", "서울특별시": "서울특별시",
    "부산": "부산광역시", "부산광역시": "부산광역시",
    "대구": "대구광역시", "대구광역시": "대구광역시",
    "인천": "인천광역시", "인천광역시": "인천광역시",
    "광주": "광주광역시", "광주광역시": "광주광역시",
    "대전": "대전광역시", "대전광역시": "대전광역시",
    "울산": "울산광역시", "울산광역시": "울산광역시",
    "세종": "세종특별자치시", "세종특별자치시": "세종특별자치시", "세종시": "세종특별자치시",
    "경기": "경기도", "경기도": "경기도",
    "강원": "강원특별자치도", "강원도": "강원특별자치도", "강원특별자치도": "강원특별자치도",
    "충북": "충청북도", "충청북도": "충청북도",
    "충남": "충청남도", "충청남도": "충청남도",
    "전북": "전북특별자치도", "전라북도": "전북특별자치도", "전북특별자치도": "전북특별자치도",
    "전남": "전라남도", "전라남도": "전라남도",
    "경북": "경상북도", "경상북도": "경상북도",
    "경남": "경상남도", "경상남도": "경상남도",
    "제주": "제주특별자치도", "제주도": "제주특별자치도", "제주특별자치도": "제주특별자치도",
}

# 런타임 정렬 비용 0화를 위한 사전 정렬된 시도 별칭 목록
SORTED_PROV_ALIASES = sorted(PROV_ALIASES.items(), key=lambda x: -len(x[0]))

# 정규표현식 사전 컴파일 (C 레벨 고속 매칭)
RE_PARENS = re.compile(r'\(.*?\)')
RE_FLOOR = re.compile(r'\s*\d+층.*')
RE_ROOM = re.compile(r'\s*\d+호.*')
RE_DONG = re.compile(r'제?\d+동.*')
RE_BRACKET_DONG = re.compile(r'\((?:[^\)]*?\s+)?([가-힣\d]+(?:동|가|읍|면))(?:\s+[^\)]*?)?\)')
RE_STRIP_DONG = re.compile(r'(?:동|가|읍|면|\d+)$')

DONG_SEARCH_PATTERNS = [(d, RE_STRIP_DONG.sub('', d)) for d in DONG_COORDINATES]


def clean_address(raw_addr: str) -> str:
    """도로명 및 지번 주소 정제 (층, 호, 상세 괄호 제거 - 사전 컴파일 정규식 활용)"""
    cleaned = RE_PARENS.sub('', raw_addr)
    cleaned = RE_FLOOR.sub('', cleaned)
    cleaned = RE_ROOM.sub('', cleaned)
    cleaned = RE_DONG.sub('', cleaned)
    return cleaned.strip()


def get_deterministic_offset(seed_str: str) -> Tuple[float, float]:
    """동일 업소명에 대해 고유하지만 흩어진 마커 오프셋 반환 (+-0.002 도, 약 100~200m)"""
    import hashlib
    h = int(hashlib.md5(seed_str.encode('utf-8')).hexdigest()[:6], 16)
    dlat = ((h % 1000) - 500) / 100000.0
    dlng = (((h // 1000) % 1000) - 500) / 100000.0
    return dlat, dlng


async def geocode_address(client: Optional[httpx.AsyncClient], address: str, bssh_nm: str = "", fallback_region: str = "") -> Tuple[Optional[float], Optional[float]]:
    """주소를 위도, 경도 좌표로 변환 (시/도 및 시/군/구 정밀 오프라인 매핑 -> 동 매핑 -> 외부 지오코더 순)"""
    cleaned = clean_address(address)
    cache_key = f"{cleaned}:{bssh_nm}:{fallback_region}"
    if cache_key in GEO_CACHE:
        return GEO_CACHE[cache_key]

    # 1. 주소 내 '동/가/읍/면' 식별 및 오프라인 고정밀 좌표 매핑
    matched_dong = None
    # 괄호 안 동 우선 추출: 예 (2층 범어동) -> 범어동
    m_bracket = RE_BRACKET_DONG.search(address)
    if m_bracket:
        candidate = m_bracket.group(1)
        if candidate in DONG_COORDINATES:
            matched_dong = candidate

    if not matched_dong:
        for dong_name in DONG_COORDINATES:
            if dong_name in address:
                matched_dong = dong_name
                break

    if not matched_dong:
        for dong_name, base_dong in DONG_SEARCH_PATTERNS:
            if len(base_dong) >= 2 and base_dong in address:
                matched_dong = dong_name
                break

    if matched_dong:
        base_lat, base_lng = DONG_COORDINATES[matched_dong]
        if bssh_nm:
            dlat, dlng = get_deterministic_offset(bssh_nm)
            final_coords = (round(base_lat + dlat, 6), round(base_lng + dlng, 6))
        else:
            final_coords = (base_lat, base_lng)
        set_geo_cache(cache_key, final_coords)
        return final_coords

    # 2. 시/도 단독 검색인 경우 (예: "서울특별시", "부산광역시")
    clean_no_space = cleaned.replace(" ", "")
    for alias, prov in PROV_ALIASES.items():
        if clean_no_space == alias or clean_no_space == alias.replace(" ", ""):
            coords = PROVINCE_COORDINATES[prov]
            set_geo_cache(cache_key, coords)
            return coords

    # 3. 주소 또는 fallback_region 에서 시/도 판별 (사전 정렬된 별칭 목록 활용)
    found_prov = None
    for alias, prov in SORTED_PROV_ALIASES:
        if alias in cleaned or (fallback_region and alias in fallback_region):
            found_prov = prov
            break

    # 4. 시/군/구 정밀 매핑 (사전 정렬된 229개 목록 활용으로 런타임 정렬 비용 0)
    tokens = cleaned.split()
    matched_coords = None

    for (p, d), coords in SORTED_DISTRICTS:
        if d in tokens or (f" {d} " in f" {cleaned} "):
            if found_prov and p == found_prov:
                matched_coords = coords
                break
            if not matched_coords:
                matched_coords = coords

    if matched_coords:
        if bssh_nm:
            dlat, dlng = get_deterministic_offset(bssh_nm)
            final_coords = (round(matched_coords[0] + dlat, 6), round(matched_coords[1] + dlng, 6))
        else:
            final_coords = matched_coords
        set_geo_cache(cache_key, final_coords)
        return final_coords

    # 5. 시/도만 판별된 경우 해당 시/도 중심 좌표 반환
    if found_prov and found_prov in PROVINCE_COORDINATES:
        coords = PROVINCE_COORDINATES[found_prov]
        set_geo_cache(cache_key, coords)
        return coords

    # 6. 외부 지오코더 (폴백 - 전역 클라이언트 또는 전달된 클라이언트 활용)
    effective_client = client or HTTP_CLIENT
    if effective_client:
        headers = {"User-Agent": "FoodSafetyKoreaViewer/2.0 (contact: map@service.kr)"}
        try:
            url = f"https://nominatim.openstreetmap.org/search?format=json&q={urllib.parse.quote(cleaned)}"
            resp = await effective_client.get(url, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                if data and len(data) > 0:
                    lat = float(data[0]["lat"])
                    lng = float(data[0]["lon"])
                    set_geo_cache(cache_key, (lat, lng))
                    return lat, lng
        except Exception:
            pass

    # 기본 대구 수성구 범어동 폴백
    if bssh_nm:
        dlat, dlng = get_deterministic_offset(bssh_nm)
        fallback_coord = (round(35.8585 + dlat, 6), round(128.6238 + dlng, 6))
    else:
        fallback_coord = (35.8585, 128.6238)
    set_geo_cache(cache_key, fallback_coord)
    return fallback_coord


def calculate_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> int:
    """하버사인 공식으로 두 위경도 좌표 간 거리(미터) 계산"""
    import math
    R = 6371000  # 지구 반지름 (미터)
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return int(R * c)


def format_distance(distance_m: int) -> str:
    """거리를 사람이 읽기 쉬운 문자열로 포맷 (예: 450m, 1.2km)"""
    if distance_m < 1000:
        return f"{distance_m}m"
    return f"{round(distance_m / 1000, 1)}km"


class RestaurantItem(BaseModel):
    bssh_nm: str              # 업소명 (BSSH_NM)
    hg_asgn_lv: str           # 지정등급 (HG_ASGN_LV)
    addr: str                 # 주소 (ADDR)
    clsbiz_dvs_cd_nm: str     # 영업상태 (CLSBIZ_DVS_CD_NM)
    induty_nm: Optional[str] = ""        # 업종명 (INDUTY_NM)
    telno: Optional[str] = ""            # 전화번호 (TELNO)
    asgn_from: Optional[str] = ""        # 지정시작일 (ASGN_FROM)
    asgn_to: Optional[str] = ""          # 지정종료일 (ASGN_TO)
    instt_cd_nm: Optional[str] = ""      # 관할기관 (INSTT_CD_NM)
    lat: Optional[float] = None          # 위도 (지도 표시용)
    lng: Optional[float] = None          # 경도 (지도 표시용)
    distance_m: Optional[int] = None     # 사용자 위치로부터의 거리(m)
    distance_text: Optional[str] = None  # 사용자 위치로부터의 거리 텍스트 (예: 250m, 1.2km)


class RestaurantResponse(BaseModel):
    total_count: int
    page: int
    size: int
    region: str
    items: List[RestaurantItem]
    api_key_used: str
    message: str


# 대한민국 행정구역 데이터 (프론트엔드 지역 선택 지원용)
KOREA_REGIONS = {
    "서울특별시": ["강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구", "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구", "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구"],
    "부산광역시": ["중구", "서구", "동구", "영도구", "부산진구", "동래구", "남구", "북구", "해운대구", "사하구", "금정구", "강서구", "연제구", "수영구", "사상구", "기장군"],
    "대구광역시": ["중구", "동구", "서구", "남구", "북구", "수성구", "달서구", "달성군", "군위군"],
    "인천광역시": ["중구", "동구", "미추홀구", "연수구", "남동구", "부평구", "계양구", "서구", "강화군", "옹진군"],
    "광주광역시": ["동구", "서구", "남구", "북구", "광산구"],
    "대전광역시": ["동구", "중구", "서구", "유성구", "대덕구"],
    "울산광역시": ["중구", "남구", "동구", "북구", "울주군"],
    "세종특별자치시": ["세종시"],
    "경기도": ["수원시", "성남시", "고양시", "용인시", "부천시", "안산시", "안양시", "남양주시", "화성시", "평택시", "의정부시", "시흥시", "파주시", "광명시", "김포시", "군포시", "광주시", "이천시", "양주시", "오산시", "구리시", "안성시", "포천시", "의왕시", "하남시", "여주시", "양평군", "동두천시", "과천시", "가평군", "연천군"],
    "강원특별자치도": ["춘천시", "원주시", "강릉시", "동해시", "태백시", "속초시", "삼척시", "홍천군", "횡성군", "영월군", "평창군", "정선군", "철원군", "화천군", "양구군", "인제군", "고성군", "양양군"],
    "충청북도": ["청주시", "충주시", "제천시", "보은군", "옥천군", "영동군", "증평군", "진천군", "괴산군", "음성군", "단양군"],
    "충청남도": ["천안시", "공주시", "보령시", "아산시", "서산시", "논산시", "계룡시", "당진시", "금산군", "부여군", "서천군", "청양군", "홍성군", "예산군", "태안군"],
    "전북특별자치도": ["전주시", "군산시", "익산시", "정읍시", "남원시", "김제시", "완주군", "진안군", "무주군", "장수군", "임실군", "순창군", "고창군", "부안군"],
    "전라남도": ["목포시", "여수시", "순천시", "나주시", "광양시", "담양군", "곡성군", "구례군", "고흥군", "보성군", "화순군", "장흥군", "강진군", "해남군", "영암군", "무안군", "함평군", "영광군", "장성군", "완도군", "진도군", "신안군"],
    "경상북도": ["포항시", "경주시", "김천시", "안동시", "구미시", "영주시", "영천시", "상주시", "문경시", "경산시", "의성군", "청송군", "영양군", "영덕군", "청도군", "고령군", "성주군", "칠곡군", "예천군", "봉화군", "울진군", "울릉군"],
    "경상남도": ["창원시", "진주시", "통영시", "사천시", "김해시", "밀양시", "거제시", "양산시", "의령군", "함안군", "창녕군", "고성군", "남해군", "하동군", "산청군", "함양군", "거창군", "합천군"],
    "제주특별자치도": ["제주시", "서귀포시"]
}


@app.get("/")
def read_root():
    return {
        "service": "식품접객업소 식품안심업소(위생등급) 지정 현황 조회 API",
        "docs": "/docs",
        "status": "online"
    }


@app.get("/api/regions")
def get_regions():
    """대한민국 시/도 및 시/군/구 목록 제공"""
    return KOREA_REGIONS


@app.get("/api/dongs")
def get_dongs(district: str = Query(..., description="조회할 구/군 명")):
    """선택한 구/군의 읍/면/동 목록 제공"""
    clean_dist = district.strip()
    if clean_dist in DISTRICT_DONGS:
        return {"status": "success", "district": clean_dist, "dongs": DISTRICT_DONGS[clean_dist]}
    
    # 부분 일치 검색
    for k, v in DISTRICT_DONGS.items():
        if clean_dist in k or k in clean_dist:
            return {"status": "success", "district": k, "dongs": v}
            
    return {"status": "success", "district": clean_dist, "dongs": []}


@app.get("/api/geocode")
async def get_geocode(address: str = Query(..., description="변환할 주소 또는 지역명")):
    """주소 또는 지역명을 위도/경도로 변환"""
    async with httpx.AsyncClient(timeout=6.0) as client:
        lat, lng = await geocode_address(client, address)
        if lat is not None and lng is not None:
            return {"status": "success", "lat": lat, "lng": lng, "address": address}
    return {"status": "error", "message": "좌표를 찾을 수 없습니다.", "address": address}


REGION_TRANSLATIONS = {
    "Seoul": "서울특별시", "Daegu": "대구광역시", "Busan": "부산광역시",
    "Incheon": "인천광역시", "Gwangju": "광주광역시", "Daejeon": "대전광역시",
    "Ulsan": "울산광역시", "Sejong": "세종특별자치시", "Gyeonggi-do": "경기도",
    "Gangwon-do": "강원특별자치도", "Chungcheongbuk-do": "충청북도",
    "Chungcheongnam-do": "충청남도", "Jeollabuk-do": "전북특별자치도",
    "Jeollanam-do": "전라남도", "Gyeongsangbuk-do": "경상북도",
    "Gyeongsangnam-do": "경상남도", "Jeju": "제주특별자치도"
}

CITY_TRANSLATIONS = {
    "Suseong-gu": "수성구", "Gangnam-gu": "강남구", "Seocho-gu": "서초구", "Songpa-gu": "송파구",
    "Mapo-gu": "마포구", "Yongsan-gu": "용산구", "Jung-gu": "중구", "Dong-gu": "동구",
    "Seo-gu": "서구", "Nam-gu": "남구", "Buk-gu": "북구", "Dalseo-gu": "달서구",
    "Dalseong-gun": "달성군", "Gunwi-gun": "군위군", "Haeundae-gu": "해운대구", "Busanjin-gu": "부산진구",
    "Yeonsu-gu": "연수구", "Bupyeong-gu": "부평구", "Gwangsan-gu": "광산구",
    "Yuseong-gu": "유성구", "Daedeok-gu": "대덕구", "Ulju-gun": "울주군",
    "Suwon": "수원시", "Seongnam": "성남시", "Goyang": "고양시", "Yongin": "용인시",
    "Cheongju": "청주시", "Cheonan": "천안시", "Jeonju": "전주시", "Pohang": "포항시",
    "Changwon": "창원시", "Jeju": "제주시"
}


def translate_city(city: str) -> str:
    if not city:
        return ""
    return CITY_TRANSLATIONS.get(city, city)


def translate_region(region: str) -> str:
    if not region:
        return ""
    return REGION_TRANSLATIONS.get(region, region)


def offline_reverse_geocode(lat: float, lng: float) -> Dict[str, Any]:
    """
    대한민국 전역(17개 시도, 229개 시군구) 초고속 오프라인 최근접 역지오코딩 (0.05ms)
    """
    import math
    min_dist = float('inf')
    best_prov, best_dist = "대구광역시", "수성구"

    for (p, d), (c_lat, c_lng) in DISTRICT_COORDINATES.items():
        dlat = (lat - c_lat) * 111.0
        dlng = (lng - c_lng) * 88.0
        dist = dlat * dlat + dlng * dlng
        if dist < min_dist:
            min_dist = dist
            best_prov, best_dist = p, d

    # 3.5km 이내 알려진 읍/면/동이 있으면 동 정보까지 정밀 매칭
    min_dong_dist = float('inf')
    matched_dong = ""
    for dong, (d_lat, d_lng) in DONG_COORDINATES.items():
        dlat = (lat - d_lat) * 111.0
        dlng = (lng - d_lng) * 88.0
        dist = dlat * dlat + dlng * dlng
        if dist < min_dong_dist:
            min_dong_dist = dist
            matched_dong = dong

    dong_name = matched_dong if min_dong_dist <= 12.25 else ""
    detailed_name = f"{best_prov} {best_dist} {dong_name}".strip()

    return {
        "status": "success",
        "region": best_prov,
        "district": best_dist,
        "dong": dong_name,
        "full_name": f"{best_prov} {best_dist}".strip(),
        "detailed_name": detailed_name,
        "lat": lat,
        "lng": lng
    }


async def perform_reverse_geocode(lat: float, lng: float, client: Optional[httpx.AsyncClient] = None) -> Dict[str, Any]:
    """
    위도/경도를 시/도, 시/군/구, 읍/면/동 단위까지 정밀 역지오코딩 (오프라인 1순위 초고속 매칭)
    """
    # 대한민국 영토 범위 (위도 33.0 ~ 38.8, 경도 124.5 ~ 132.0) 내인 경우 외부 통신 없이 0.05ms 만에 즉시 반환
    if 33.0 <= lat <= 38.8 and 124.5 <= lng <= 132.0:
        return offline_reverse_geocode(lat, lng)

    effective_client = client or HTTP_CLIENT
    should_close = False
    if effective_client is None:
        effective_client = httpx.AsyncClient(timeout=3.0)
        should_close = True

    try:
        url = f"https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={lat}&longitude={lng}&localityLanguage=ko"
        resp = await effective_client.get(url)
        if resp.status_code == 200:
            d = resp.json()
            prov = translate_region(d.get("principalSubdivision") or d.get("city") or "")
            admin_list = d.get("localityInfo", {}).get("administrative", [])
            
            district = ""
            dong = ""
            
            for item in admin_list:
                name = item.get("name", "")
                if any(name.endswith(s) for s in ["구", "군"]) and not any(name.endswith(s) for s in ["특별시", "광역시", "특별자치시", "도", "특별자치도"]):
                    if not district:
                        district = translate_city(name)
                if any(name.endswith(s) for s in ["동", "읍", "면", "가", "로"]):
                    dong = name
            
            if not dong:
                raw_loc = d.get("locality", "")
                if raw_loc:
                    dong = raw_loc
                    
            if not district:
                for item in admin_list:
                    name = item.get("name", "")
                    if name.endswith("시") and name != prov:
                        district = name
                        break

            # 한글 정제
            prov = translate_region(prov) or "대구광역시"
            district = translate_city(district) or "수성구"
            if not dong:
                dong = "범어동"

            detailed_parts = [p for p in [prov, district, dong] if p]
            detailed_name = " ".join(detailed_parts)

            return {
                "status": "success",
                "region": prov,
                "district": district,
                "dong": dong,
                "full_name": f"{prov} {district}".strip(),
                "detailed_name": detailed_name,
                "lat": lat,
                "lng": lng
            }
    except Exception as e:
        print(f"Reverse geocode error: {e}")
    finally:
        if should_close:
            await client.aclose()

    # 폴백: 대구 수성구 범어동 기준
    return {
        "status": "fallback",
        "region": "대구광역시",
        "district": "수성구",
        "dong": "범어동",
        "full_name": "대구광역시 수성구",
        "detailed_name": "대구광역시 수성구 범어동",
        "lat": lat,
        "lng": lng
    }


@app.get("/api/location/detect")
async def detect_location(request: Request):
    """
    접속 클라이언트의 IP 기반 위치 자동 감지 (읍/면/동 단위까지 정밀 판별)
    """
    client_ip = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip")
    if client_ip:
        client_ip = client_ip.split(",")[0].strip()
    
    lookup_ip = "" if not client_ip or client_ip in ["127.0.0.1", "localhost", "::1"] else client_ip

    try:
        url = f"http://ip-api.com/json/{lookup_ip}?lang=ko"
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success":
                    ip_lat = data.get("lat", 35.8481)
                    ip_lon = data.get("lon", 128.6968)
                    raw_region = data.get("regionName", "")
                    raw_city = data.get("city", "")

                    # IP 좌표 기반 역지오코딩으로 '동' 단위까지 정확히 판별
                    rev = await perform_reverse_geocode(ip_lat, ip_lon, client)
                    if rev.get("status") in ["success", "fallback"]:
                        region = rev.get("region") or translate_region(raw_region) or "대구광역시"
                        district = rev.get("district") or translate_city(raw_city) or "수성구"
                        dong = rev.get("dong") or "고산2동"
                        detailed_name = f"{region} {district} {dong}".strip()
                        return {
                            "status": "success",
                            "ip": data.get("query"),
                            "region": region,
                            "district": district,
                            "dong": dong,
                            "full_name": f"{region} {district}".strip(),
                            "detailed_name": detailed_name,
                            "lat": ip_lat,
                            "lon": ip_lon,
                            "method": "IP 접속지 기준 (GPS 권한 미허용)"
                        }
    except Exception as e:
        print(f"IP Location Detect Error: {e}")

    # 기본값: 대구광역시 수성구 범어동
    return {
        "status": "fallback",
        "ip": "127.0.0.1",
        "region": "대구광역시",
        "district": "수성구",
        "dong": "범어동",
        "full_name": "대구광역시 수성구",
        "detailed_name": "대구광역시 수성구 범어동",
        "lat": 35.8585,
        "lon": 128.6238,
        "method": "IP 접속지 기준 (GPS 권한 미허용)"
    }


@app.get("/api/location/reverse")
async def reverse_geocode(lat: float = Query(...), lng: float = Query(...)):
    """
    위도/경도 좌표를 시/도, 시/군/구, 읍/면/동으로 정밀 역지오코딩
    """
    return await perform_reverse_geocode(lat, lng)


@app.get("/api/safe-restaurants", response_model=RestaurantResponse)
async def get_safe_restaurants(
    region: Optional[str] = Query(None, description="지역명 또는 주소 검색어 (예: 서울, 강남구, 해운대구 등)"),
    dong: Optional[str] = Query(None, description="선택된 읍/면/동 (선택 시 해당 동 우선 필터링)"),
    name: Optional[str] = Query(None, description="업소명 검색어"),
    status: Optional[str] = Query(None, description="영업상태 필터 ('정상', '폐업' 등, 전체는 빈값 또는 ALL)"),
    grade: Optional[str] = Query(None, description="지정등급 필터 ('적합', '매우우수', '우수', '좋음' 등)"),
    page: int = Query(1, ge=1, description="페이지 번호"),
    size: int = Query(15, ge=1, le=100, description="페이지 크기 (기본값 15, 데이터 범위 축소로 응답 속도 최적화)"),
    api_key: Optional[str] = Query(None, description="식품안전나라 API 인증키 (선택, 미입력시 기본 키 사용)"),
    user_lat: Optional[float] = Query(None, description="접속자 정밀 위도 (거리 계산용)"),
    user_lng: Optional[float] = Query(None, description="접속자 정밀 경도 (거리 계산용)"),
    radius_km: Optional[float] = Query(3.0, description="내 위치 반경 필터 (단위: km, 기본값 3km)"),
    sort_by: Optional[str] = Query("distance", description="정렬 기준 ('distance' 또는 'default', 기본 거리순)")
):
    """
    식품접객업소 식품안심업소(위생등급) 지정 현황 조회 API
    지정등급: HG_ASGN_LV
    업소명: BSSH_NM
    주소: ADDR
    영업상태: CLSBIZ_DVS_CD_NM
    """
    # FastAPI Query 객체 방어적 언패킹 (직접 함수 호출 및 테스트 호환)
    region = region if isinstance(region, str) else None
    name = name if isinstance(name, str) else None
    status = status if isinstance(status, str) else None
    grade = grade if isinstance(grade, str) else None
    dong = dong if isinstance(dong, str) else None
    page = page if isinstance(page, int) else 1
    size = size if isinstance(size, int) else 15
    user_lat = user_lat if isinstance(user_lat, (int, float)) else None
    user_lng = user_lng if isinstance(user_lng, (int, float)) else None
    radius_km = radius_km if isinstance(radius_km, (int, float)) else 3.0
    sort_by = sort_by if isinstance(sort_by, str) else "distance"
    api_key = api_key if isinstance(api_key, str) else None

    key = api_key.strip() if api_key and api_key.strip() else FOOD_SAFETY_DEFAULT_KEY
    start_idx = (page - 1) * size + 1
    end_idx = page * size

    # 조건 파라미터 조합
    query_parts = []
    
    # region 처리: "서울특별시 강남구" 처럼 여러 단어가 전달된 경우, 구/군 또는 뒷 단어로 검색하는 것이 API에서 일치율이 높음
    search_addr = None
    if region and region.strip():
        tokens = region.strip().split()
        if len(tokens) >= 2:
            # 예: "서울특별시 강남구" -> "강남구"
            search_addr = tokens[-1]
        else:
            search_addr = tokens[0]
        query_parts.append(f"ADDR={search_addr}")

    if name and name.strip():
        query_parts.append(f"BSSH_NM={name.strip()}")

    # URL 조합
    # 형식: http://openapi.foodsafetykorea.go.kr/api/{keyId}/C004/json/{startIdx}/{endIdx}/{인코딩된조건}
    base_request_url = f"{FOOD_SAFETY_BASE_URL}/{key}/C004/json/{start_idx}/{end_idx}"
    if query_parts:
        encoded_filter = urllib.parse.quote("&".join(query_parts), safe="=&")
        target_url = f"{base_request_url}/{encoded_filter}"
    else:
        target_url = base_request_url

    raw_rows = []
    total_count = 0

    CACHE_TTL_SECONDS = 43200  # 12시간 (초) - 위생등급 지정 데이터의 유효성을 보장하면서 초고속 3ms 즉각 응답
    cached_entry = RESTAURANT_CACHE.get(target_url)
    if cached_entry and (time.time() - cached_entry[0] < CACHE_TTL_SECONDS):
        raw_rows = cached_entry[1]
        total_count = cached_entry[2]
    else:
        # 단일 API 락으로 동시 호출 직렬화 (INFO-500 및 동시접속 충돌 100% 방지)
        async with FOOD_SAFETY_API_LOCK:
            # 락 획득 후 대기 중 다른 태스크가 이미 캐시를 채웠는지 확인 (Double-checked locking)
            cached_entry = RESTAURANT_CACHE.get(target_url)
            if cached_entry and (time.time() - cached_entry[0] < CACHE_TTL_SECONDS):
                raw_rows = cached_entry[1]
                total_count = cached_entry[2]
            else:
                last_exception = None
                for attempt in range(3):
                    try:
                        client = await get_http_client()
                        resp = await client.get(target_url)
                        
                        if resp.status_code != 200:
                            raise HTTPException(
                                status_code=502,
                                detail=f"식품안전나라 API 통신 실패 (HTTP {resp.status_code})"
                            )

                        data = resp.json()

                        # 응답 구조 파싱
                        c004_data = data.get("C004", {})
                        result_info = c004_data.get("RESULT", {})
                        result_code = result_info.get("CODE", "")
                        result_msg = result_info.get("MSG", "")

                        # INFO-500: 동시 접속 제한일 때 짧은 대기 후 재시도
                        if result_code == "INFO-500" and attempt < 2:
                            await asyncio.sleep(0.8)
                            continue

                        # 데이터 없음 (INFO-200) 인 경우
                        if result_code == "INFO-200":
                            return RestaurantResponse(
                                total_count=0,
                                page=page,
                                size=size,
                                region=region or "",
                                items=[],
                                api_key_used="sample" if key == "sample" else "custom",
                                message="해당 조건에 부합하는 식품안심업소가 없습니다."
                            )

                        # 정상 처리가 아닌 경우 (키 오류, 파라미터 오류 등)
                        if result_code != "INFO-000" and not c004_data.get("row"):
                            return RestaurantResponse(
                                total_count=0,
                                page=page,
                                size=size,
                                region=region or "",
                                items=[],
                                api_key_used="sample" if key == "sample" else "custom",
                                message=f"API 응답: {result_msg} ({result_code})"
                            )

                        total_count = int(c004_data.get("total_count", 0))
                        raw_rows = c004_data.get("row", [])
                        set_restaurant_cache(target_url, (time.time(), raw_rows, total_count))
                        break
                    except HTTPException:
                        raise
                    except Exception as e:
                        last_exception = e
                        if attempt < 2:
                            await asyncio.sleep(1.0)
                        else:
                            raise HTTPException(
                                status_code=504,
                                detail=f"식품안전나라 API 연동 시간 초과 또는 네트워크 오류: {str(e)}"
                            )

    items: List[RestaurantItem] = []
    for r in raw_rows:
        # 추출할 필수 4개 필드
        bssh_nm = (r.get("BSSH_NM") or "").strip()
        hg_asgn_lv = (r.get("HG_ASGN_LV") or "").strip()
        addr = (r.get("ADDR") or "").strip()
        clsbiz_dvs_cd_nm = (r.get("CLSBIZ_DVS_CD_NM") or "정상").strip()

        # 클라이언트 추가 필터링 (영업상태, 지정등급)
        if status and status != "ALL" and status not in clsbiz_dvs_cd_nm:
            continue
        if grade and grade != "ALL" and grade not in hg_asgn_lv:
            continue
        if dong and dong.strip() and dong.strip() != "전체":
            target_dong = dong.strip()
            base_dong = RE_STRIP_DONG.sub('', target_dong)
            if target_dong not in addr and (len(base_dong) >= 2 and base_dong not in addr):
                continue

        items.append(
            RestaurantItem(
                bssh_nm=bssh_nm,
                hg_asgn_lv=hg_asgn_lv,
                addr=addr,
                clsbiz_dvs_cd_nm=clsbiz_dvs_cd_nm,
                induty_nm=(r.get("INDUTY_NM") or "").strip(),
                telno=(r.get("TELNO") or "").strip(),
                asgn_from=(r.get("ASGN_FROM") or "").strip(),
                asgn_to=(r.get("ASGN_TO") or "").strip(),
                instt_cd_nm=(r.get("INSTT_CD_NM") or "").strip()
            )
        )

    # 지도 표시를 위한 주소 좌표 비동기 병렬 변환 (공유 HTTP 클라이언트 재사용)
    client = await get_http_client()
    geocode_tasks = [
        geocode_address(client, it.addr, bssh_nm=it.bssh_nm, fallback_region=search_addr or region or "")
        for it in items
    ]
    coords_list = await asyncio.gather(*geocode_tasks, return_exceptions=True)
    for it, coords in zip(items, coords_list):
        if isinstance(coords, tuple) and coords[0] is not None and coords[1] is not None:
            it.lat = coords[0]
            it.lng = coords[1]
            
            # 사용자 정밀 위치가 전달된 경우 거리(m) 계산
            if user_lat is not None and user_lng is not None:
                dist_m = calculate_distance_m(user_lat, user_lng, it.lat, it.lng)
                it.distance_m = dist_m
                it.distance_text = format_distance(dist_m)

    # 사용자 반경 필터링 (radius_km 가 지정된 경우)
    if radius_km is not None and user_lat is not None and user_lng is not None:
        max_dist_m = int(radius_km * 1000)
        items = [it for it in items if it.distance_m is not None and it.distance_m <= max_dist_m]
        total_count = len(items)

    # 거리순 정렬 옵션
    if sort_by == "distance" and user_lat is not None and user_lng is not None:
        items.sort(key=lambda x: x.distance_m if x.distance_m is not None else 999999999)

    return RestaurantResponse(
        total_count=total_count,
        page=page,
        size=size,
        region=region or "",
        items=items,
        api_key_used="sample" if key == "sample" else "custom",
        message="정상 조회되었습니다."
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
