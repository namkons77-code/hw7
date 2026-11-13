from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_root():
    response = client.get("/")
    assert response.status_code == 200
    print("Root test OK:", response.json())

def test_regions():
    response = client.get("/api/regions")
    assert response.status_code == 200
    data = response.json()
    assert "서울특별시" in data
    print("Regions test OK, count of provinces:", len(data))

def test_detect_location():
    response = client.get("/api/location/detect")
    assert response.status_code == 200
    data = response.json()
    print("Detect location OK:", data.get("full_name"), data.get("ip"))

def test_safe_restaurants():
    response = client.get("/api/safe-restaurants?region=강남구&size=5")
    assert response.status_code == 200
    data = response.json()
    print("Restaurants query OK. Total count:", data.get("total_count"), "Items retrieved:", len(data.get("items", [])))
    if data.get("items"):
        first = data["items"][0]
        print("First item sample:")
        print(" - 업소명 (BSSH_NM):", first.get("bssh_nm"))
        print(" - 지정등급 (HG_ASGN_LV):", first.get("hg_asgn_lv"))
        print(" - 주소 (ADDR):", first.get("addr"))
        print(" - 영업상태 (CLSBIZ_DVS_CD_NM):", first.get("clsbiz_dvs_cd_nm"))

if __name__ == "__main__":
    test_root()
    test_regions()
    test_detect_location()
    test_safe_restaurants()
    print(">>> All backend tests passed successfully!")
