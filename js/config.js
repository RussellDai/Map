/* ===== config.js: 全局配置 ===== */
const CONFIG = {
  /* 高德官方瓦片（GCJ02 坐标系，无需 Key） style=8 路网, 6 卫星, 8(webst) 卫星注记 */
  tileRoad: 'https://webrd0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}&lang=zh_cn&size=1&scale=1',
  tileSat: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
  tileSatLabel: 'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}',
  subdomains: ['1', '2', '3', '4'],

  /* 两个圆心：wgs84 为 OpenStreetMap 实测坐标，运行时自动转 GCJ02 与高德底图对齐 */
  centers: [
    {
      key: 'yaoguan', name: '遥观卫生院', radius: 13000, color: '#2563eb',
      wgs84: [120.0307979, 31.7038270],
      note: '来源：OpenStreetMap「遥观镇卫生院」（WGS84，已自动纠偏）'
    },
    {
      key: 'jintan', name: '金坛德国中心', radius: 37000, color: '#ea580c',
      wgs84: [119.6516667, 31.7377025],
      note: '来源：OpenStreetMap「中国(常州)德国中心」（WGS84，已自动纠偏）'
    }
  ],

  /* Overpass（OpenStreetMap 查询）镜像列表；普通加载按序故障转移，搜索时并行竞速 */
  overpassEndpoints: [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ],

  /* 常州行政区划外接矩形 S,W,N,E（用于地名搜索） */
  czBBox: '31.25,119.25,32.15,120.45',

  /* 小区分级：清单排序、地图标记配色均按此配置 */
  levels: [
    { key: 'focus', name: '重点关注', color: '#dc2626' },
    { key: 'backup', name: '备选', color: '#2563eb' },
    { key: 'exclude', name: '排除', color: '#94a3b8' }
  ],

  /* 街景：Mapillary 全球街景，浏览无需 Key（国内覆盖有限，以主路为主）。
     focus=map 打开地图模式：蓝点=有街景覆盖的位置，可直观判断附近哪些路有影像 */
  streetViewUrl: 'https://www.mapillary.com/app/?focus=map&lat={lat}&lng={lng}&z=17',

  /* 高德 JS API 2.0（🏙 3D实景）：Web端 Key + 安全密钥，控制台 https://console.amap.com 管理 */
  amap: {
    key: '8d2fe372f1fbf1c12f3105c865e4cbc4',
    securityJsCode: 'ceffc45862f2243f6d2cc55b81f0e41f'
  },

  storageKey: 'cz-house-map-v1',  // localStorage 键
  minLoadZoom: 12                 // 地图放大到该级别后自动加载视野内小区
};
