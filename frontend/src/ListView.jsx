import React from 'react';
import {
  MapPin,
  Search,
  RefreshCw,
  ShieldCheck,
  Building2,
  Phone,
  Calendar,
  ExternalLink,
  Copy,
  LayoutGrid,
  List,
  AlertCircle,
  Map as MapIcon,
  Navigation
} from 'lucide-react';

export default function ListView({
  restaurants,
  totalCount,
  loading,
  page,
  setPage,
  pageSize,
  detectedLocation,
  isLocating,
  onRefreshLocation,
  selectedProvince,
  selectedDistrict,
  selectedDong = '',
  onDongChange,
  availableDongs = [],
  provinces,
  onProvinceChange,
  onDistrictChange,
  searchName,
  inputName,
  setInputName,
  onSearchSubmit,
  statusFilter,
  setStatusFilter,
  gradeFilter,
  setGradeFilter,
  radiusKm,
  setRadiusKm,
  sortBy,
  setSortBy,
  viewMode,
  setViewMode,
  onNavigateToMap,
  showToast
}) {
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  const handleCopyAddress = (addr) => {
    navigator.clipboard.writeText(addr);
    showToast('주소가 클립보드에 복사되었습니다.');
  };

  const getMapLink = (name, addr) => {
    return `https://map.kakao.com/link/search/${encodeURIComponent(name + ' ' + addr)}`;
  };

  const getGradeBadgeClass = (lv) => {
    if (!lv) return 'badge-grade badge-grade-suitable';
    if (lv.includes('매우') || lv.includes('3')) return 'badge-grade badge-grade-top';
    if (lv.includes('우수') || lv.includes('2')) return 'badge-grade badge-grade-gold';
    return 'badge-grade badge-grade-suitable';
  };

  return (
    <div className="list-view-layout">
      {/* Precision Location Indicator */}
      <div className="list-loc-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="precision-badge">📍 현재 접속 지역</span>
          <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>
            {detectedLocation.detailedName || detectedLocation.fullName}
          </strong>
          {detectedLocation.dong && (
            <span className="dong-tag">{detectedLocation.dong}</span>
          )}
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>({detectedLocation.method})</span>
        </div>

        <button
          className="btn-refresh-loc"
          onClick={onRefreshLocation}
          disabled={isLocating}
        >
          <RefreshCw size={13} className={isLocating ? 'spin' : ''} />
          <span>{isLocating ? '측위 중...' : 'GPS 재측위'}</span>
        </button>
      </div>

      {/* Search & Filter Control Panel */}
      <div className="control-panel">
        <div className="control-row">
          {/* 시/도 선택 */}
          <div className="form-group">
            <label>시 / 도 선택</label>
            <select
              className="select-input"
              value={selectedProvince}
              onChange={onProvinceChange}
            >
              <option value="">시/도 전체</option>
              {Object.keys(provinces).map((prov) => (
                <option key={prov} value={prov}>{prov}</option>
              ))}
            </select>
          </div>

          {/* 시/군/구 선택 */}
          <div className="form-group">
            <label>시 / 군 / 구 선택</label>
            <select
              className="select-input"
              value={selectedDistrict}
              onChange={onDistrictChange}
              disabled={!selectedProvince}
            >
              <option value="">전체 구/군</option>
              {(provinces[selectedProvince] || []).map((dist) => (
                <option key={dist} value={dist}>{dist}</option>
              ))}
            </select>
          </div>

          {/* 읍/면/동 선택 */}
          <div className="form-group">
            <label>읍 / 면 / 동 선택</label>
            <select
              className="select-input"
              value={selectedDong}
              onChange={onDongChange}
              disabled={!selectedDistrict}
            >
              <option value="">전체 읍/면/동</option>
              {(availableDongs || []).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* 업소명 검색 */}
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label>업소명 검색</label>
            <form onSubmit={onSearchSubmit} className="search-bar-row">
              <div className="search-input-wrap">
                <Search size={18} className="search-icon" />
                <input
                  type="text"
                  className="text-input"
                  placeholder="예: 스타벅스, 본죽, 맥도날드 등 업소명 입력"
                  value={inputName}
                  onChange={(e) => setInputName(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-primary">
                검색
              </button>
            </form>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="filters-row">
          {/* 거리 반경 필터 */}
          <div className="filter-pills">
            <span className="filter-pills-label">거리 반경:</span>
            {[
              { id: 1, label: '1km 이내' },
              { id: 3, label: '3km 이내 (기본)' },
              { id: 5, label: '5km 이내' },
              { id: 10, label: '10km 이내' }
            ].map((r) => (
              <button
                key={String(r.id)}
                className={`pill-btn ${radiusKm === r.id ? 'active' : ''}`}
                onClick={() => setRadiusKm(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* 정렬 기준 */}
          <div className="filter-pills">
            <span className="filter-pills-label">정렬:</span>
            <button
              className={`pill-btn ${sortBy === 'distance' ? 'active' : ''}`}
              onClick={() => setSortBy('distance')}
            >
              가까운 순
            </button>
            <button
              className={`pill-btn ${sortBy === 'default' ? 'active' : ''}`}
              onClick={() => setSortBy('default')}
            >
              기본 등록순
            </button>
          </div>

          {/* 영업 상태 필터 */}
          <div className="filter-pills">
            <span className="filter-pills-label">영업상태:</span>
            {['정상', '전체', '폐업'].map((st) => (
              <button
                key={st}
                className={`pill-btn ${statusFilter === st ? 'active' : ''}`}
                onClick={() => { setStatusFilter(st); setPage(1); }}
              >
                {st === '전체' ? '전체 상태' : st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results Header */}
      <div className="results-header">
        <div className="results-count">
          <strong>{selectedDistrict || selectedProvince || detectedLocation.fullName}</strong> 주변 식품안심업소
          {' '}(총 <strong>{totalCount.toLocaleString()}</strong>개)
          {searchName && <span> — 검색어: "{searchName}"</span>}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className="btn-primary"
            onClick={onNavigateToMap}
            style={{ padding: '6px 14px', fontSize: '0.85rem' }}
          >
            <MapIcon size={15} />
            <span>지도 보기</span>
          </button>

          <div className="view-toggle">
            <button
              className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="카드 뷰"
            >
              <LayoutGrid size={16} />
              <span>카드</span>
            </button>
            <button
              className={`view-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
              title="목록 뷰"
            >
              <List size={16} />
              <span>표</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="loading-box">
          <div className="spinner"></div>
          <p style={{ color: 'var(--text-muted)' }}>식품안전나라에서 안심업소 목록을 불러오는 중입니다...</p>
        </div>
      ) : restaurants.length === 0 ? (
        <div className="empty-state">
          <AlertCircle size={48} className="empty-icon" />
          <h3>해당 조건에 부합하는 업소가 없습니다</h3>
          <p>반경 필터를 넓히거나 다른 지역명으로 다시 시도해 보세요.</p>
        </div>
      ) : viewMode === 'grid' ? (
        /* Card Grid View */
        <div className="restaurant-grid">
          {restaurants.map((item, idx) => (
            <div key={`${item.bssh_nm}-${idx}`} className="restaurant-card">
              <div>
                <div className="card-top">
                  <div>
                    <h3 className="restaurant-name">{item.bssh_nm}</h3>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                      {item.distance_text && (
                        <span className="distance-badge">
                          📍 {item.distance_text}
                        </span>
                      )}
                      {item.induty_nm && (
                        <span className="category-tag">{item.induty_nm}</span>
                      )}
                    </div>
                  </div>
                  <div className="badges-group">
                    {/* 지정등급 (HG_ASGN_LV) */}
                    <span className={getGradeBadgeClass(item.hg_asgn_lv)}>
                      <ShieldCheck size={14} />
                      {item.hg_asgn_lv || '적합'}
                    </span>
                    {/* 영업상태 (CLSBIZ_DVS_CD_NM) */}
                    <span className={`badge-status ${item.clsbiz_dvs_cd_nm.includes('폐업') ? 'badge-status-closed' : 'badge-status-normal'}`}>
                      {item.clsbiz_dvs_cd_nm || '정상'}
                    </span>
                  </div>
                </div>

                <div className="card-details">
                  {/* 주소 (ADDR) */}
                  <div className="detail-item">
                    <MapPin size={16} />
                    <span>{item.addr || '주소 정보 없음'}</span>
                  </div>

                  {/* 전화번호 (있을 경우) */}
                  {item.telno && (
                    <div className="detail-item">
                      <Phone size={16} />
                      <span>{item.telno}</span>
                    </div>
                  )}

                  {/* 지정기간 */}
                  {item.asgn_from && item.asgn_to && (
                    <div className="detail-item">
                      <Calendar size={16} />
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        지정기간: {item.asgn_from} ~ {item.asgn_to}
                      </span>
                    </div>
                  )}

                  {/* 관할기관 */}
                  {item.instt_cd_nm && (
                    <div className="detail-item">
                      <Building2 size={16} />
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        지자체: {item.instt_cd_nm}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="card-bottom">
                <button
                  className="btn-card-action"
                  onClick={() => handleCopyAddress(item.addr)}
                  title="주소 복사"
                >
                  <Copy size={13} />
                  <span>주소 복사</span>
                </button>
                <a
                  href={getMapLink(item.bssh_nm, item.addr)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-card-action btn-map-link"
                >
                  <ExternalLink size={13} />
                  <span>지도 길찾기</span>
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Table View */
        <div className="table-container">
          <table className="restaurant-table">
            <thead>
              <tr>
                <th>업소명</th>
                <th>거리</th>
                <th>지정등급</th>
                <th>영업상태</th>
                <th>주소</th>
                <th>업종</th>
                <th>지도</th>
              </tr>
            </thead>
            <tbody>
              {restaurants.map((item, idx) => (
                <tr key={`${item.bssh_nm}-${idx}`}>
                  <td style={{ fontWeight: 600 }}>{item.bssh_nm}</td>
                  <td>
                    {item.distance_text ? (
                      <span className="distance-badge">
                        {item.distance_text}
                      </span>
                    ) : '-'}
                  </td>
                  <td>
                    <span className={getGradeBadgeClass(item.hg_asgn_lv)}>
                      {item.hg_asgn_lv || '적합'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge-status ${item.clsbiz_dvs_cd_nm.includes('폐업') ? 'badge-status-closed' : 'badge-status-normal'}`}>
                      {item.clsbiz_dvs_cd_nm || '정상'}
                    </span>
                  </td>
                  <td>{item.addr}</td>
                  <td>{item.induty_nm || '-'}</td>
                  <td>
                    <a
                      href={getMapLink(item.bssh_nm, item.addr)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-card-action btn-map-link"
                      style={{ padding: '4px 8px' }}
                    >
                      <ExternalLink size={12} />
                      <span>보기</span>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="page-btn"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            이전
          </button>

          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let pageNum;
            if (totalPages <= 5) {
              pageNum = i + 1;
            } else if (page <= 3) {
              pageNum = i + 1;
            } else if (page >= totalPages - 2) {
              pageNum = totalPages - 4 + i;
            } else {
              pageNum = page - 2 + i;
            }
            return (
              <button
                key={pageNum}
                className={`page-btn ${page === pageNum ? 'active' : ''}`}
                onClick={() => setPage(pageNum)}
              >
                {pageNum}
              </button>
            );
          })}

          <button
            className="page-btn"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
