import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  ShieldCheck,
  CheckCircle2,
  Map as MapIcon,
  List as ListIcon,
  Search,
  MapPin,
  X
} from 'lucide-react';

import MapView from './MapView';
import ListView from './ListView';

const API_BASE = '/api';

export default function App() {
  // 현재 페이지: 'map' (메인 index.html) | 'list' (list.html)
  const [currentPage, setCurrentPage] = useState(() => {
    return window.location.pathname.includes('list') ? 'list' : 'map';
  });

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPage(window.location.pathname.includes('list') ? 'list' : 'map');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (pageName) => {
    setCurrentPage(pageName);
    const targetUrl = pageName === 'list' ? '/list.html' : '/';
    if (window.location.pathname !== targetUrl) {
      window.history.pushState(null, '', targetUrl);
    }
  };

  // 정밀 접속 위치 상태
  const [detectedLocation, setDetectedLocation] = useState({
    region: '대구광역시',
    district: '수성구',
    dong: '범어1동',
    road: '달구벌대로480길',
    fullName: '대구광역시 수성구',
    detailedName: '대구광역시 수성구 범어1동',
    lat: 35.8585,
    lon: 128.6238,
    accuracy: 15,
    method: '정밀 탐색 중...'
  });
  const [isLocating, setIsLocating] = useState(false);

  // 시/도, 시/군/구, 읍/면/동 데이터
  const [provinces, setProvinces] = useState({});
  const [selectedProvince, setSelectedProvince] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [selectedDong, setSelectedDong] = useState('');
  const [availableDongs, setAvailableDongs] = useState([]);

  // 검색 및 필터 상태
  const [searchName, setSearchName] = useState('');
  const [inputName, setInputName] = useState('');
  const [statusFilter, setStatusFilter] = useState('정상');
  const [gradeFilter, setGradeFilter] = useState('ALL');
  const [radiusKm, setRadiusKm] = useState(3); // 기본값: 3km 이내 설정
  const [sortBy, setSortBy] = useState('distance'); // 기본값: 가까운 거리순

  // 페이지 및 결과 데이터
  const [restaurants, setRestaurants] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(40); // 3km 반경 내 업소를 풍부하게 수집하도록 넉넉히 설정
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState('grid');

  // 모달 상태
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [manualAddressInput, setManualAddressInput] = useState('');
  const [isGeocodingManual, setIsGeocodingManual] = useState(false);

  // 알림 토스트
  const [toastMessage, setToastMessage] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 3000);
  };

  // 전국 시/도 목록 로드
  useEffect(() => {
    axios.get(`${API_BASE}/regions`)
      .then(res => setProvinces(res.data))
      .catch(err => console.error('시/도 목록 로드 실패:', err));
  }, []);

  // 선택한 구/군의 읍/면/동 목록 로드
  useEffect(() => {
    const targetDistrict = selectedDistrict || detectedLocation.district;
    if (targetDistrict) {
      axios.get(`${API_BASE}/dongs?district=${encodeURIComponent(targetDistrict)}`)
        .then(res => {
          setAvailableDongs(res.data.dongs || []);
        })
        .catch(err => {
          console.error('동 목록 로드 실패:', err);
          setAvailableDongs([]);
        });
    } else {
      setAvailableDongs([]);
    }
  }, [selectedDistrict, detectedLocation.district]);

  // 고정밀 위치 감지 함수 (HTML5 High-Accuracy GPS 1순위 -> IP 2순위)
  const detectUserLocation = useCallback(async (isManualRefresh = false) => {
    setIsLocating(true);

    const fallbackToIp = async () => {
      try {
        const res = await axios.get(`${API_BASE}/location/detect`);
        const { region, district, dong, detailed_name, full_name, lat, lon, method } = res.data;
        const newLoc = {
          region: region || '대구광역시',
          district: district || '수성구',
          dong: dong || '범어동',
          road: '',
          fullName: full_name || `${region} ${district}`,
          detailedName: detailed_name || `${region} ${district} ${dong || '범어동'}`.trim(),
          lat: lat || 35.8585,
          lon: lon || 128.6238,
          accuracy: null,
          method: method || 'IP 접속지 기준 (GPS 권한 미허용)'
        };
        setDetectedLocation(newLoc);
        setSelectedProvince(region || '대구광역시');
        setSelectedDistrict(district || '수성구');
        if (isManualRefresh) {
          showToast(`접속 위치(${newLoc.detailedName})로 감지되었습니다.`);
        }
      } catch (e) {
        setDetectedLocation({
          region: '대구광역시',
          district: '수성구',
          dong: '범어동',
          road: '',
          fullName: '대구광역시 수성구 범어동',
          detailedName: '대구광역시 수성구 범어동',
          lat: 35.8585,
          lon: 128.6238,
          accuracy: null,
          method: '기본 접속 위치'
        });
        setSelectedProvince('대구광역시');
        setSelectedDistrict('수성구');
      } finally {
        setIsLocating(false);
      }
    };

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const { latitude, longitude, accuracy } = position.coords;
            // 고정밀 좌표를 동/읍/면 단위로 역지오코딩
            const res = await axios.get(`${API_BASE}/location/reverse?lat=${latitude}&lng=${longitude}`);
            if (res.data.status === 'success') {
              const { region, district, dong, road, detailed_name, detailed_name_full, full_name } = res.data;
              const newLoc = {
                region: region || '대구광역시',
                district: district || '',
                dong: dong || '',
                road: road || '',
                fullName: full_name || `${region} ${district}`,
                detailedName: detailed_name || full_name,
                lat: latitude,
                lon: longitude,
                accuracy: accuracy,
                method: `GPS 고정밀 측위 (오차 ±${Math.round(accuracy)}m)`
              };
              setDetectedLocation(newLoc);
              setSelectedProvince(region || '');
              setSelectedDistrict(district || '');
              showToast(`정밀 접속 위치(${newLoc.detailedName})를 감지했습니다.`);
              setIsLocating(false);
              return;
            }
          } catch (err) {
            console.warn('역지오코딩 실패, IP로 폴백:', err);
          }
          await fallbackToIp();
        },
        async (error) => {
          console.warn('Geolocation 권한 거부 또는 타임아웃, IP 감지 사용:', error.message);
          await fallbackToIp();
        },
        {
          enableHighAccuracy: false, // 데스크톱 PC 환경에서 빠르고 안정적인 Wi-Fi 위치 측위
          timeout: 8000,
          maximumAge: 60000          // 1분 내 캐시된 위치 활용으로 즉각 응답
        }
      );
    } else {
      await fallbackToIp();
    }
  }, []);

  useEffect(() => {
    detectUserLocation(false);
  }, [detectUserLocation]);

  // 탐색 기준 모드: 'MY_LOCATION' (처음 접속 시: 내 접속위치 기준) | 'MAP_CENTER' (지도를 움직였을 때: 지도 중심 기준)
  const [searchMode, setSearchMode] = useState('MY_LOCATION');

  // 지도 중심 위치 상태 (지도를 움직일 때 실시간 반영)
  const [mapCenterLocation, setMapCenterLocation] = useState(null);
  const [isMapMovingLoading, setIsMapMovingLoading] = useState(false);
  const abortControllerRef = useRef(null);

  // 안심식당 목록 조회 (거리 계산 및 정밀 파라미터 전달, AbortController로 중복/레이스 컨디션 차단)
  const fetchRestaurants = useCallback(async (forcedMode = null, customCenter = null) => {
    // 이전 요청이 아직 처리 중이면 즉각 취소(Cancel)하여 대기열 누적 및 중복 호출 차단
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    try {
      const currentMode = forcedMode || searchMode;
      const center = currentMode === 'MAP_CENTER' && (customCenter || mapCenterLocation)
        ? (customCenter || mapCenterLocation)
        : detectedLocation;

      let queryRegion = currentMode === 'MAP_CENTER'
        ? (center.district || center.region || selectedDistrict || '수성구')
        : (selectedDistrict || selectedProvince || center.district || center.region || '수성구');

      const params = {
        region: queryRegion,
        dong: selectedDong || undefined,
        name: searchName || undefined,
        status: statusFilter === '전체' ? undefined : statusFilter,
        grade: gradeFilter === 'ALL' ? undefined : gradeFilter,
        page,
        size: pageSize,
        user_lat: center.lat || undefined,
        user_lng: center.lon || center.lng || undefined,
        radius_km: radiusKm || undefined,
        sort_by: sortBy
      };

      const res = await axios.get(`${API_BASE}/safe-restaurants`, {
        params,
        signal: controller.signal
      });
      setRestaurants(res.data.items || []);
      setTotalCount(res.data.total_count || 0);
    } catch (err) {
      if (axios.isCancel(err) || err.name === 'CanceledError') {
        return; // 이전 요청 취소 건은 무시
      }
      console.error('업소 조회 실패:', err);
      showToast('안심업소 데이터를 가져오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [searchMode, selectedProvince, selectedDistrict, selectedDong, mapCenterLocation, detectedLocation, searchName, statusFilter, gradeFilter, radiusKm, sortBy, page, pageSize]);

  useEffect(() => {
    if (selectedProvince || selectedDistrict || detectedLocation.district) {
      fetchRestaurants();
    }
  }, [fetchRestaurants, selectedDong]);

  // 사용자가 지도를 움직였을 때 지도 중심 기준 반경 3km 업소 조회 핸들러 (중복 호출 없이 단일 파이프라인 연계)
  const handleMapCenterChange = useCallback(async (lat, lng) => {
    setSearchMode('MAP_CENTER'); // 기준을 지도 중심으로 전환!
    setIsMapMovingLoading(true);
    try {
      // 1. 지도 중심 좌표 고속 오프라인 역지오코딩
      const revRes = await axios.get(`${API_BASE}/location/reverse?lat=${lat}&lng=${lng}`);
      let newCenterData = {
        lat,
        lng,
        lon: lng,
        region: '',
        district: '',
        detailedName: '지도 중심'
      };

      if (revRes.data.status === 'success' || revRes.data.status === 'fallback') {
        const { region, district, dong, detailed_name } = revRes.data;
        newCenterData = {
          lat,
          lng,
          lon: lng,
          region: region || '',
          district: district || '',
          dong: dong || '',
          detailedName: detailed_name || `${region || ''} ${district || ''} ${dong || ''}`.trim() || '지도 중심'
        };
      }

      // 지도 중심 위치 업데이트 (useEffect -> fetchRestaurants 단일 경로로 중복 쿼리 없이 자동 연동)
      setMapCenterLocation(newCenterData);
    } catch (err) {
      console.error('지도 중심 역지오코딩 실패:', err);
    } finally {
      setIsMapMovingLoading(false);
    }
  }, []);

  // 내 실제 접속 위치로 복귀 (다시 접속 위치 기준 모드로 전환)
  const handleReturnToMyLocation = useCallback(() => {
    setSearchMode('MY_LOCATION');
    setMapCenterLocation(null);
    fetchRestaurants('MY_LOCATION');
    showToast('내 실제 접속 위치를 기준으로 복귀했습니다.');
  }, [fetchRestaurants]);

  // 사용자가 특정 동이나 도로명을 직접 입력해 정밀 위치 설정
  const handleManualAddressSubmit = async (e) => {
    e.preventDefault();
    if (!manualAddressInput.trim()) return;

    setIsGeocodingManual(true);
    try {
      const geoRes = await axios.get(`${API_BASE}/geocode?address=${encodeURIComponent(manualAddressInput.trim())}`);
      if (geoRes.data.status === 'success' && geoRes.data.lat && geoRes.data.lng) {
        const { lat, lng } = geoRes.data;
        const revRes = await axios.get(`${API_BASE}/location/reverse?lat=${lat}&lng=${lng}`);
        const data = revRes.data;

        setDetectedLocation({
          region: data.region || '',
          district: data.district || '',
          dong: data.dong || '',
          road: data.road || '',
          fullName: data.full_name || manualAddressInput,
          detailedName: data.detailed_name || manualAddressInput,
          lat: lat,
          lon: lng,
          accuracy: 5,
          method: '직접 지정한 정밀 위치'
        });

        if (data.region) setSelectedProvince(data.region);
        if (data.district) setSelectedDistrict(data.district);

        setIsLocationModalOpen(false);
        setManualAddressInput('');
        showToast(`정밀 위치가 "${data.detailed_name || manualAddressInput}"(으)로 설정되었습니다.`);
      } else {
        showToast('해당 주소의 정밀 좌표를 찾지 못했습니다. 다른 주소로 검색해 보세요.');
      }
    } catch (err) {
      showToast('주소 검색 중 오류가 발생했습니다.');
    } finally {
      setIsGeocodingManual(false);
    }
  };

  const handleProvinceChange = async (e) => {
    const prov = e.target.value;
    setSelectedProvince(prov);
    setSelectedDistrict('');
    setSelectedDong('');
    setPage(1);

    if (prov) {
      try {
        const geoRes = await axios.get(`${API_BASE}/geocode?address=${encodeURIComponent(prov)}`);
        if (geoRes.data.status === 'success' && geoRes.data.lat && geoRes.data.lng) {
          const { lat, lng } = geoRes.data;
          const newCenterData = {
            lat,
            lng,
            lon: lng,
            region: prov,
            district: '',
            dong: '',
            detailedName: prov,
            zoom: 11
          };
          setMapCenterLocation(newCenterData);
          setSearchMode('MAP_CENTER');
          showToast(`"${prov}"(으)로 이동합니다.`);
        }
      } catch (err) {
        console.error('시/도 지오코딩 실패:', err);
      }
    } else {
      handleReturnToMyLocation();
    }
  };

  const handleDistrictChange = async (e) => {
    const dist = e.target.value;
    setSelectedDistrict(dist);
    setSelectedDong('');
    setPage(1);

    if (dist) {
      const query = selectedProvince ? `${selectedProvince} ${dist}` : dist;
      try {
        const geoRes = await axios.get(`${API_BASE}/geocode?address=${encodeURIComponent(query)}`);
        if (geoRes.data.status === 'success' && geoRes.data.lat && geoRes.data.lng) {
          const { lat, lng } = geoRes.data;
          const newCenterData = {
            lat,
            lng,
            lon: lng,
            region: selectedProvince,
            district: dist,
            dong: '',
            detailedName: `${selectedProvince} ${dist}`.trim(),
            zoom: 13
          };
          setMapCenterLocation(newCenterData);
          setSearchMode('MAP_CENTER');
          showToast(`"${selectedProvince} ${dist}"(으)로 이동합니다.`);
        }
      } catch (err) {
        console.error('구/군 이동 오류:', err);
      }
    } else if (selectedProvince) {
      try {
        const geoRes = await axios.get(`${API_BASE}/geocode?address=${encodeURIComponent(selectedProvince)}`);
        if (geoRes.data.status === 'success' && geoRes.data.lat && geoRes.data.lng) {
          const { lat, lng } = geoRes.data;
          const newCenterData = {
            lat,
            lng,
            lon: lng,
            region: selectedProvince,
            district: '',
            dong: '',
            detailedName: selectedProvince,
            zoom: 11
          };
          setMapCenterLocation(newCenterData);
          setSearchMode('MAP_CENTER');
        }
      } catch (err) {
        console.error('시/도 복귀 오류:', err);
      }
    }
  };

  const handleDongChange = async (e) => {
    const dong = e.target.value;
    setSelectedDong(dong);
    setPage(1);

    if (dong) {
      // 선택한 동 좌표로 이동
      try {
        const query = `${selectedProvince} ${selectedDistrict} ${dong}`.trim();
        const geoRes = await axios.get(`${API_BASE}/geocode?address=${encodeURIComponent(query)}`);
        if (geoRes.data.status === 'success' && geoRes.data.lat && geoRes.data.lng) {
          const { lat, lng } = geoRes.data;
          const newCenterData = {
            lat,
            lng,
            lon: lng,
            region: selectedProvince,
            district: selectedDistrict,
            dong: dong,
            detailedName: `${selectedProvince} ${selectedDistrict} ${dong}`.trim(),
            zoom: 15
          };
          setMapCenterLocation(newCenterData);
          setSearchMode('MAP_CENTER');
          showToast(`"${selectedProvince} ${selectedDistrict} ${dong}"(으)로 이동합니다.`);
        }
      } catch (err) {
        console.error('동 지오코딩 실패:', err);
      }
    } else {
      // 전체 읍/면/동 선택 시 구/군 중심으로 복귀
      if (selectedDistrict) {
        try {
          const query = `${selectedProvince} ${selectedDistrict}`.trim();
          const geoRes = await axios.get(`${API_BASE}/geocode?address=${encodeURIComponent(query)}`);
          if (geoRes.data.status === 'success' && geoRes.data.lat && geoRes.data.lng) {
            const { lat, lng } = geoRes.data;
            const newCenterData = {
              lat,
              lng,
              lon: lng,
              region: selectedProvince,
              district: selectedDistrict,
              dong: '',
              detailedName: `${selectedProvince} ${selectedDistrict}`.trim(),
              zoom: 13
            };
            setMapCenterLocation(newCenterData);
            setSearchMode('MAP_CENTER');
          }
        } catch (err) {
          console.error('구/군 지오코딩 실패:', err);
        }
      }
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSearchName(inputName);
    setPage(1);
  };

  return (
    <div className="app-container">
      {/* Toast */}
      {toastMessage && (
        <div className="toast">
          <CheckCircle2 size={18} color="#10b981" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Global Header */}
      <header className="header-card">
        <div className="header-top">
          <div className="header-title-box">
            <h1>
              <ShieldCheck size={28} color="#34d399" />
              식품안심업소(위생등급) 지정 현황
            </h1>
            <p>
              식품의약품안전처 공공데이터 기반 안심 먹거리 검색 및 지도 서비스
            </p>
          </div>
        </div>
      </header>

      {/* View Switcher */}
      {currentPage === 'map' ? (
        <MapView
          restaurants={restaurants}
          totalCount={totalCount}
          loading={loading || isMapMovingLoading}
          searchMode={searchMode}
          detectedLocation={detectedLocation}
          mapCenterLocation={mapCenterLocation}
          onMapCenterChange={handleMapCenterChange}
          onReturnToMyLocation={handleReturnToMyLocation}
          isLocating={isLocating}
          onRefreshLocation={() => {
            setSearchMode('MY_LOCATION');
            setMapCenterLocation(null);
            detectUserLocation(true);
          }}
          onOpenLocationModal={() => setIsLocationModalOpen(true)}
          selectedProvince={selectedProvince}
          selectedDistrict={selectedDistrict}
          selectedDong={selectedDong}
          onDongChange={handleDongChange}
          availableDongs={availableDongs}
          provinces={provinces}
          onProvinceChange={handleProvinceChange}
          onDistrictChange={handleDistrictChange}
          searchName={searchName}
          inputName={inputName}
          setInputName={setInputName}
          onSearchSubmit={handleSearchSubmit}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          gradeFilter={gradeFilter}
          setGradeFilter={setGradeFilter}
          radiusKm={radiusKm}
          setRadiusKm={setRadiusKm}
          sortBy={sortBy}
          setSortBy={setSortBy}
          onNavigateToList={() => navigateTo('list')}
          showToast={showToast}
        />
      ) : (
        <ListView
          restaurants={restaurants}
          totalCount={totalCount}
          loading={loading}
          page={page}
          setPage={setPage}
          pageSize={pageSize}
          detectedLocation={detectedLocation}
          isLocating={isLocating}
          onRefreshLocation={() => detectUserLocation(true)}
          selectedProvince={selectedProvince}
          selectedDistrict={selectedDistrict}
          selectedDong={selectedDong}
          onDongChange={handleDongChange}
          availableDongs={availableDongs}
          provinces={provinces}
          onProvinceChange={handleProvinceChange}
          onDistrictChange={handleDistrictChange}
          searchName={searchName}
          inputName={inputName}
          setInputName={setInputName}
          onSearchSubmit={handleSearchSubmit}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          gradeFilter={gradeFilter}
          setGradeFilter={setGradeFilter}
          radiusKm={radiusKm}
          setRadiusKm={setRadiusKm}
          sortBy={sortBy}
          setSortBy={setSortBy}
          viewMode={viewMode}
          setViewMode={setViewMode}
          onNavigateToMap={() => navigateTo('map')}
          showToast={showToast}
        />
      )}

      {/* Manual Location Search Modal */}
      {isLocationModalOpen && (
        <div className="modal-overlay" onClick={() => setIsLocationModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>정밀 위치 직접 설정</h3>
              <button className="btn-close" onClick={() => setIsLocationModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
                GPS 권한이 제한되어 있거나 다른 동네/건물 주변을 정밀하게 탐색하고 싶을 때, 동(예: 범어동, 역삼동) 또는 도로명 주소를 입력하세요.
              </p>
              <form onSubmit={handleManualAddressSubmit} className="search-bar-row">
                <div className="search-input-wrap">
                  <MapPin size={18} className="search-icon" />
                  <input
                    type="text"
                    className="text-input"
                    placeholder="예: 대구 수성구 범어동, 서울 강남구 역삼역 등"
                    value={manualAddressInput}
                    onChange={(e) => setManualAddressInput(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={isGeocodingManual}>
                  {isGeocodingManual ? '검색 중...' : '설정'}
                </button>
              </form>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsLocationModalOpen(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
