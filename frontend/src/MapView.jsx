import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MapPin,
  ShieldCheck,
  ExternalLink,
  Copy,
  Search,
  LocateFixed
} from 'lucide-react';

export default function MapView({
  restaurants,
  totalCount,
  loading,
  searchMode = 'MY_LOCATION',
  detectedLocation,
  mapCenterLocation,
  onMapCenterChange,
  onReturnToMyLocation,
  isLocating = false,
  onRefreshLocation,
  selectedProvince,
  selectedDistrict,
  selectedDong = '',
  onDongChange,
  availableDongs = [],
  provinces,
  onProvinceChange,
  onDistrictChange,
  inputName,
  setInputName,
  onSearchSubmit,
  radiusKm = 3.0,
  setRadiusKm,
  showToast
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const restaurantMarkersLayerRef = useRef(null);
  const userMarkerLayerRef = useRef(null);
  const radiusCircleRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const isUserDraggingRef = useRef(false);

  const [selectedRestaurant, setSelectedRestaurant] = useState(null);

  // 지도 인스턴스 초기화 & 드래그 이벤트
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const initialLat = detectedLocation.lat || 35.8585;
      const initialLng = detectedLocation.lon || 128.6238;

      const map = L.map(mapContainerRef.current, {
        center: [initialLat, initialLng],
        zoom: 14,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      userMarkerLayerRef.current = L.layerGroup().addTo(map);
      restaurantMarkersLayerRef.current = L.layerGroup().addTo(map);

      // 3km 반경 원 초기 생성
      const initialCircle = L.circle([initialLat, initialLng], {
        radius: (radiusKm || 3.0) * 1000,
        color: '#059669',
        fillColor: '#10b981',
        fillOpacity: 0.08,
        weight: 2,
        dashArray: '6, 6'
      });
      initialCircle.addTo(map);
      radiusCircleRef.current = initialCircle;

      map.on('dragstart', () => {
        isUserDraggingRef.current = true;
      });

      map.on('drag', () => {
        if (radiusCircleRef.current) {
          radiusCircleRef.current.setLatLng(map.getCenter());
        }
      });

      map.on('dragend', () => {
        const center = map.getCenter();
        if (radiusCircleRef.current) {
          radiusCircleRef.current.setLatLng(center);
        }

        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }

        debounceTimerRef.current = setTimeout(() => {
          if (onMapCenterChange) {
            onMapCenterChange(center.lat, center.lng);
          }
          isUserDraggingRef.current = false;
        }, 400);
      });

      mapInstanceRef.current = map;
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // radiusKm 변경 시 반경 크기 갱신
  useEffect(() => {
    if (radiusCircleRef.current) {
      if (radiusKm && radiusKm > 0) {
        radiusCircleRef.current.setRadius(radiusKm * 1000);
        radiusCircleRef.current.setStyle({ opacity: 1, fillOpacity: 0.08 });
      } else {
        radiusCircleRef.current.setStyle({ opacity: 0, fillOpacity: 0 });
      }
    }
  }, [radiusKm]);

  // 처음 접속 시 또는 접속 위치가 감지되었을 때 반경 원 위치 설정
  useEffect(() => {
    if (searchMode === 'MY_LOCATION' && radiusCircleRef.current && detectedLocation.lat && detectedLocation.lon) {
      radiusCircleRef.current.setLatLng([detectedLocation.lat, detectedLocation.lon]);
      if (mapInstanceRef.current && !isUserDraggingRef.current) {
        mapInstanceRef.current.setView([detectedLocation.lat, detectedLocation.lon], 14);
      }
    }
  }, [detectedLocation, searchMode]);

  // 드롭다운 지역 선택(시/도, 구/군, 동) 또는 외부에서 mapCenterLocation이 변경되었을 때 지도 즉각 이동
  useEffect(() => {
    if (mapCenterLocation && mapCenterLocation.lat && mapCenterLocation.lng && mapInstanceRef.current && !isUserDraggingRef.current) {
      const zoomLevel = mapCenterLocation.zoom || 14;
      mapInstanceRef.current.flyTo([mapCenterLocation.lat, mapCenterLocation.lng], zoomLevel, { duration: 0.8 });
      if (radiusCircleRef.current) {
        radiusCircleRef.current.setLatLng([mapCenterLocation.lat, mapCenterLocation.lng]);
      }
    }
  }, [mapCenterLocation]);

  // 사용자 실제 접속 위치 마커 렌더링 (파란색 펄스 핀)
  useEffect(() => {
    if (!mapInstanceRef.current || !userMarkerLayerRef.current) return;

    userMarkerLayerRef.current.clearLayers();

    if (detectedLocation.lat && detectedLocation.lon) {
      const uLat = detectedLocation.lat;
      const uLng = detectedLocation.lon;

      const userIcon = L.divIcon({
        className: 'user-pulse-marker',
        html: `
          <div class="user-pulse-wrapper">
            <div class="user-pulse-ring"></div>
            <div class="user-pulse-core"></div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14],
      });

      const userMarker = L.marker([uLat, uLng], { icon: userIcon });
      const popupContent = `
        <div style="font-family: inherit; padding: 4px 2px; min-width: 200px;">
          <div style="font-size: 0.78rem; font-weight: 700; color: #2563eb; margin-bottom: 2px;">
            📍 내 접속 위치
          </div>
          <div style="font-size: 0.95rem; font-weight: 800; color: #0f172a;">
            ${detectedLocation.detailedName || detectedLocation.fullName}
          </div>
        </div>
      `;
      userMarker.bindPopup(popupContent);
      userMarkerLayerRef.current.addLayer(userMarker);
    }
  }, [detectedLocation]);

  // 안심식당 마커 렌더링
  useEffect(() => {
    if (!mapInstanceRef.current || !restaurantMarkersLayerRef.current) return;

    restaurantMarkersLayerRef.current.clearLayers();

    const validItems = restaurants.filter(
      (item) => typeof item.lat === 'number' && typeof item.lng === 'number'
    );

    if (validItems.length === 0) return;

    validItems.forEach((item) => {
      const isTop = (item.hg_asgn_lv || '').includes('매우') || (item.hg_asgn_lv || '').includes('3');
      const pinColor = isTop ? '#1d4ed8' : '#059669';

      const customIcon = L.divIcon({
        className: 'custom-map-marker',
        html: `
          <div style="
            background-color: ${pinColor};
            width: 32px;
            height: 32px;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            border: 2px solid white;
            cursor: pointer;
          ">
            <svg style="transform: rotate(45deg); width: 16px; height: 16px; fill: none; stroke: white; stroke-width: 2.2;" viewBox="0 0 24 24">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="m9 12 2 2 4-4"/>
            </svg>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
      });

      const marker = L.marker([item.lat, item.lng], { icon: customIcon });

      const distLabelPrefix = searchMode === 'MY_LOCATION' ? '내 위치에서' : '지도 중심에서';
      const distBadge = item.distance_text
        ? `<span style="background: #e0f2fe; color: #0369a1; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem;">${distLabelPrefix} ${item.distance_text}</span>`
        : '';

      const popupHtml = `
        <div style="font-family: inherit; padding: 4px 2px; min-width: 230px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
            <span style="font-size: 0.78rem; font-weight: 700; color: ${pinColor};">★ 위생등급 [${item.hg_asgn_lv || '적합'}]</span>
            ${distBadge}
          </div>
          <h4 style="font-size: 1.05rem; font-weight: 800; margin: 0 0 6px 0; color: #0f172a;">
            ${item.bssh_nm}
          </h4>
          <div style="font-size: 0.82rem; color: #475569; margin-bottom: 4px; display: flex; gap: 4px; align-items: flex-start;">
            <span>📍</span>
            <span>${item.addr}</span>
          </div>
          <div style="font-size: 0.8rem; color: #64748b; margin-bottom: 8px;">
            상태: <strong style="color: ${item.clsbiz_dvs_cd_nm.includes('폐업') ? '#ef4444' : '#10b981'}">${item.clsbiz_dvs_cd_nm || '정상'}</strong>
            ${item.induty_nm ? ` · ${item.induty_nm}` : ''}
          </div>
          <div style="display: flex; gap: 6px; margin-top: 8px;">
            <a href="https://map.kakao.com/link/search/${encodeURIComponent(item.bssh_nm + ' ' + item.addr)}"
               target="_blank"
               rel="noopener noreferrer"
               style="flex: 1; text-align: center; background: #059669; color: white; padding: 6px 8px; border-radius: 6px; font-size: 0.78rem; font-weight: 600; text-decoration: none;">
               카카오 길찾기
            </a>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      marker.on('click', () => {
        setSelectedRestaurant(item);
      });

      restaurantMarkersLayerRef.current.addLayer(marker);
    });
  }, [restaurants, searchMode]);

  // 사이드바에서 업소 클릭 시 해당 마커로 이동 및 팝업 열기
  const handleSelectRestaurant = (item) => {
    setSelectedRestaurant(item);
    if (mapInstanceRef.current && item.lat && item.lng) {
      mapInstanceRef.current.flyTo([item.lat, item.lng], 16, { duration: 0.8 });

      restaurantMarkersLayerRef.current.eachLayer((layer) => {
        const latLng = layer.getLatLng();
        if (Math.abs(latLng.lat - item.lat) < 0.0001 && Math.abs(latLng.lng - item.lng) < 0.0001) {
          layer.openPopup();
        }
      });
    }
  };

  // 내 실제 접속 위치로 복귀 클릭 핸들러
  const handleResetToMyLocation = () => {
    if (mapInstanceRef.current && detectedLocation.lat && detectedLocation.lon) {
      mapInstanceRef.current.flyTo([detectedLocation.lat, detectedLocation.lon], 14, { duration: 0.8 });
      if (radiusCircleRef.current) {
        radiusCircleRef.current.setLatLng([detectedLocation.lat, detectedLocation.lon]);
      }
      if (onReturnToMyLocation) {
        onReturnToMyLocation();
      }
    }
  };

  // 접속 위치 재감지 클릭 핸들러
  const handleReDetectLocation = () => {
    if (onRefreshLocation) {
      onRefreshLocation();
    }
    if (mapInstanceRef.current && detectedLocation.lat && detectedLocation.lon) {
      mapInstanceRef.current.flyTo([detectedLocation.lat, detectedLocation.lon], 14, { duration: 0.8 });
      if (radiusCircleRef.current) {
        radiusCircleRef.current.setLatLng([detectedLocation.lat, detectedLocation.lon]);
      }
    }
  };

  const handleCopyAddress = (addr) => {
    navigator.clipboard.writeText(addr);
    showToast('주소가 복사되었습니다.');
  };

  const isMyLocationMode = searchMode === 'MY_LOCATION';
  const currentBaseName = isMyLocationMode
    ? (detectedLocation.detailedName || `${detectedLocation.region || ''} ${detectedLocation.district || ''} ${detectedLocation.dong || ''}`.trim())
    : (mapCenterLocation?.detailedName || '지도 중심');

  return (
    <div className="map-view-layout">
      {/* 깔끔한 단일 검색 & 필터 바 */}
      <div className="map-filter-bar">
        {/* 지역 선택 */}
        <div className="filter-group-sm">
          <select
            className="select-input-sm"
            value={selectedProvince}
            onChange={onProvinceChange}
          >
            <option value="">시/도 전체</option>
            {Object.keys(provinces).map((prov) => (
              <option key={prov} value={prov}>{prov}</option>
            ))}
          </select>

          <select
            className="select-input-sm"
            value={selectedDistrict}
            onChange={onDistrictChange}
            disabled={!selectedProvince}
          >
            <option value="">전체 구/군</option>
            {(provinces[selectedProvince] || []).map((dist) => (
              <option key={dist} value={dist}>{dist}</option>
            ))}
          </select>

          <select
            className="select-input-sm"
            value={selectedDong}
            onChange={onDongChange}
            disabled={!selectedDistrict}
          >
            <option value="">전체 읍/면/동</option>
            {(availableDongs || []).map((dong) => (
              <option key={dong} value={dong}>{dong}</option>
            ))}
          </select>
        </div>

        {/* 탐색 반경 필터 */}
        <div className="filter-group-sm radius-group">
          <span className="filter-label-sm">탐색 반경:</span>
          {[
            { id: 1, label: '1km' },
            { id: 3, label: '3km (기본)' },
            { id: 5, label: '5km' },
            { id: 10, label: '10km' }
          ].map((r) => (
            <button
              key={String(r.id)}
              className={`pill-btn-sm ${radiusKm === r.id ? 'active' : ''}`}
              onClick={() => setRadiusKm(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* 업소명 검색 */}
        <form onSubmit={onSearchSubmit} className="map-search-form">
          <input
            type="text"
            className="text-input-sm"
            placeholder="업소명 검색..."
            value={inputName}
            onChange={(e) => setInputName(e.target.value)}
          />
          <button type="submit" className="btn-search-sm" title="검색">
            <Search size={14} />
          </button>
        </form>
      </div>

      {/* Main Map + Sidebar Area */}
      <div className="map-main-container">
        {/* Leaflet Map Canvas */}
        <div className="map-canvas-wrapper">
          <div ref={mapContainerRef} className="map-canvas" />

          {/* 지도 위 상단 플로팅 상태 태그 */}
          <div className="map-floating-tag">
            <span className={`precision-badge ${isMyLocationMode ? 'mode-my-loc' : 'mode-map-center'}`}>
              {isMyLocationMode ? '📍 내 접속위치 기준' : '🎯 지도 중심 기준'}
            </span>
            <strong style={{ fontSize: '0.85rem' }}>{currentBaseName}</strong>
            <span className="radius-active-badge">반경 {radiusKm}km 이내</span>
          </div>

          {/* 지도 중심 모드일 때 내 위치로 복귀 버튼 */}
          {!isMyLocationMode && (
            <button
              className="map-floating-return-btn"
              onClick={handleResetToMyLocation}
              title="내 접속 위치로 복귀"
            >
              <LocateFixed size={15} color="#2563eb" />
              <span>내 위치로 복귀</span>
            </button>
          )}

          {/* 지도를 움직였을 때 지도 중심 조준점 표시 */}
          {!isMyLocationMode && (
            <div className="map-center-crosshair" title="지도 중심">
              <div className="crosshair-dot"></div>
            </div>
          )}

          {/* 지도 이동 중 자동 갱신 인디케이터 */}
          {loading && (
            <div className="map-floating-indicator">
              <div className="spinner-sm"></div>
              <span>반경 {radiusKm}km 업소 탐색 중...</span>
            </div>
          )}

          {/* 접속 위치 재감지 버튼 (적합/우수 범례 삭제 및 내 위치 버튼화) */}
          <button
            className="map-my-location-btn"
            onClick={handleReDetectLocation}
            title="접속 위치 재감지"
            disabled={isLocating}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#2563eb',
                display: 'inline-block',
                boxShadow: '0 0 0 2px rgba(37, 99, 235, 0.25)'
              }}
            ></span>
            <span>{isLocating ? '접속위치 감지 중...' : '내 위치'}</span>
          </button>
        </div>

        {/* Sidebar: 업소 목록 패널 */}
        <div className="map-sidebar">
          <div className="sidebar-header">
            <div>
              <h3>
                <ShieldCheck size={20} color="#059669" />
                안심식당 목록
              </h3>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {isMyLocationMode ? '내 접속위치' : '지도 중심'} ({currentBaseName}) 기준 반경 {radiusKm}km
              </div>
            </div>
            <span className="sidebar-count">
              총 <strong>{restaurants.length}</strong>개
            </span>
          </div>

          <div className="sidebar-list">
            {restaurants.length === 0 ? (
              <div className="sidebar-empty">
                <p>반경 {radiusKm}km 내에 식품안심업소가 없습니다.</p>
                <small>지도를 다른 위치로 이동해 보세요.</small>
              </div>
            ) : (
              restaurants.map((item, idx) => {
                const isSelected = selectedRestaurant?.bssh_nm === item.bssh_nm;
                return (
                  <div
                    key={`${item.bssh_nm}-${idx}`}
                    className={`sidebar-card ${isSelected ? 'active' : ''}`}
                    onClick={() => handleSelectRestaurant(item)}
                  >
                    <div className="sidebar-card-top">
                      <h4 className="sidebar-card-title">{item.bssh_nm}</h4>
                      <span className="badge-grade badge-grade-suitable">
                        {item.hg_asgn_lv || '적합'}
                      </span>
                    </div>

                    <div className="sidebar-card-addr">
                      <MapPin size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>{item.addr}</span>
                    </div>

                    <div className="sidebar-card-meta">
                      {item.distance_text && (
                        <span className="distance-badge">
                          📍 {isMyLocationMode ? '내 위치에서' : '중심에서'} {item.distance_text}
                        </span>
                      )}
                      <span className="badge-status badge-status-normal">
                        {item.clsbiz_dvs_cd_nm || '정상'}
                      </span>
                      {item.induty_nm && (
                        <span className="category-tag">{item.induty_nm}</span>
                      )}
                    </div>

                    <div className="sidebar-card-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn-card-action-sm"
                        onClick={() => handleCopyAddress(item.addr)}
                        title="주소 복사"
                      >
                        <Copy size={12} />
                        <span>복사</span>
                      </button>
                      <a
                        href={`https://map.kakao.com/link/search/${encodeURIComponent(item.bssh_nm + ' ' + item.addr)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-card-action-sm btn-map-link"
                      >
                        <ExternalLink size={12} />
                        <span>길찾기</span>
                      </a>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
