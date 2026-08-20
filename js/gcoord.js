/* ===== gcoord.js: WGS84(国际标准/OSM) → GCJ02(高德/国测局) 坐标纠偏 ===== */
const GC = (() => {
  const A = 6378245.0;               // 长半轴
  const EE = 0.00669342162296594323; // 偏心率平方

  function outOfChina(lng, lat) {
    return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
  }
  function transformLat(lng, lat) {
    let r = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat +
      0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
    r += (20.0 * Math.sin(6.0 * lng * Math.PI) + 20.0 * Math.sin(2.0 * lng * Math.PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(lat * Math.PI) + 40.0 * Math.sin(lat / 3.0 * Math.PI)) * 2.0 / 3.0;
    r += (160.0 * Math.sin(lat / 12.0 * Math.PI) + 320.0 * Math.sin(lat * Math.PI / 30.0)) * 2.0 / 3.0;
    return r;
  }
  function transformLng(lng, lat) {
    let r = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng +
      0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
    r += (20.0 * Math.sin(6.0 * lng * Math.PI) + 20.0 * Math.sin(2.0 * lng * Math.PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(lng * Math.PI) + 40.0 * Math.sin(lng / 3.0 * Math.PI)) * 2.0 / 3.0;
    r += (150.0 * Math.sin(lng / 12.0 * Math.PI) + 300.0 * Math.sin(lng / 30.0 * Math.PI)) * 2.0 / 3.0;
    return r;
  }
  /* 输入 WGS84 [lng,lat]，返回 GCJ02 [lng,lat] */
  function wgs84ToGcj02(lng, lat) {
    if (outOfChina(lng, lat)) return [lng, lat];
    let dLat = transformLat(lng - 105.0, lat - 35.0);
    let dLng = transformLng(lng - 105.0, lat - 35.0);
    const radLat = lat / 180.0 * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * Math.PI);
    dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * Math.PI);
    return [lng + dLng, lat + dLat];
  }
  /* 输入 GCJ02 [lng,lat]，返回 WGS84 [lng,lat]（迭代反解，误差 < 1 米） */
  function gcj02ToWgs84(lng, lat) {
    if (outOfChina(lng, lat)) return [lng, lat];
    let wlng = lng, wlat = lat;
    for (let i = 0; i < 4; i++) {
      const g = wgs84ToGcj02(wlng, wlat);
      wlng += lng - g[0];
      wlat += lat - g[1];
    }
    return [wlng, wlat];
  }
  return { wgs84ToGcj02, gcj02ToWgs84 };
})();
