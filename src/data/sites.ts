// 采集站点配置（单一来源）：切换站点后，分类/列表/封面/播放全部走当前站 apiBase
export type SiteConfig = {
  id: string;
  name: string;
  apiBase: string;
  // 可选：个别站点接口的 class 不返回 type_pid 但层级是真实的（如鸭鸭资源），
  // 用此表补全父子关系（type_id -> 父级 type_id）；其余站点自适应：缺失即平铺
  typePidMap?: Record<number, number>;
};

export const SITES: SiteConfig[] = [
  { id: "souav", name: "色猫资源", apiBase: "https://api.souavzyw.net/api.php/provide/vod/" },
  { id: "naixx", name: "奶香香资源", apiBase: "https://Naixxzy.com/api.php/provide/vod/" },
  { id: "jingpin", name: "精品资源", apiBase: "https://www.jingpinx.com/api.php/provide/vod/" },
  { id: "souav2", name: "搜AV", apiBase: "https://api.souavzy.vip/api.php/provide/vod/" },
  { id: "xingba", name: "杏吧资源", apiBase: "https://json.xingba222.com/api.php/provide/vod/" },
  { id: "yutu", name: "玉兔资源", apiBase: "https://apiyutu.com/api.php/provide/vod/" },
  { id: "shayu", name: "鲨鱼资源", apiBase: "https://shayuapi.com/api.php/provide/vod/at/json/" },
  { id: "115", name: "115资源", apiBase: "https://155api.com/api.php/provide/vod/" },
  { id: "fanhao", name: "番号资源", apiBase: "http://fhapi9.com/api.php/provide/vod/at/json/" },
  { id: "aosika", name: "奥斯卡资源", apiBase: "https://aosikazy1.com/api.php/provide/vod/" },
  { id: "senlin", name: "森林资源", apiBase: "https://slapibf.com/api.php/provide/vod/" },
  {
    id: "yaya",
    name: "鸭鸭资源",
    apiBase: "https://cj.yayazy.net/api.php/provide/vod/",
    // 该站 class 未返回 type_pid，按分类命名归纳补全
    typePidMap: {
      // 电影
      6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1, 20: 1, 62: 1, 70: 1, 71: 1,
      // 电视剧
      13: 2, 14: 2, 15: 2, 16: 2, 17: 2, 18: 2, 19: 2, 23: 2, 72: 2,
      // 综艺
      25: 3, 26: 3, 27: 3, 28: 3,
      // 动漫
      29: 4, 30: 4, 31: 4, 39: 4, 44: 4, 45: 4, 63: 4,
      // 体育赛事
      49: 48, 50: 48, 52: 48,
      // 伦理
      56: 55, 57: 55, 58: 55, 59: 55, 60: 55,
    },
  },
];
