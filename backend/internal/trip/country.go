package trip

import "strings"

// countryAliases maps country names that show up in screenshots and older
// records to ISO 3166-1 alpha-2 codes. Keys are lowercase with spaces removed.
var countryAliases = map[string]string{
	"中国": "CN", "中国大陆": "CN", "中华人民共和国": "CN", "china": "CN", "mainlandchina": "CN",
	"香港": "HK", "中国香港": "HK", "hongkong": "HK",
	"澳门": "MO", "中国澳门": "MO", "macau": "MO", "macao": "MO",
	"台湾": "TW", "中国台湾": "TW", "taiwan": "TW",
	"日本": "JP", "japan": "JP",
	"韩国": "KR", "southkorea": "KR", "korea": "KR",
	"朝鲜": "KP", "northkorea": "KP",
	"蒙古": "MN", "mongolia": "MN",
	"泰国": "TH", "thailand": "TH",
	"越南": "VN", "vietnam": "VN",
	"马来西亚": "MY", "malaysia": "MY",
	"新加坡": "SG", "singapore": "SG",
	"印度尼西亚": "ID", "印尼": "ID", "indonesia": "ID",
	"菲律宾": "PH", "philippines": "PH",
	"柬埔寨": "KH", "cambodia": "KH",
	"老挝": "LA", "laos": "LA",
	"缅甸": "MM", "myanmar": "MM",
	"文莱": "BN", "brunei": "BN",
	"印度": "IN", "india": "IN",
	"尼泊尔": "NP", "nepal": "NP",
	"斯里兰卡": "LK", "srilanka": "LK",
	"马尔代夫": "MV", "maldives": "MV",
	"阿联酋": "AE", "阿拉伯联合酋长国": "AE", "uae": "AE", "unitedarabemirates": "AE",
	"卡塔尔": "QA", "qatar": "QA",
	"沙特阿拉伯": "SA", "saudiarabia": "SA",
	"土耳其": "TR", "turkey": "TR", "türkiye": "TR",
	"以色列": "IL", "israel": "IL",
	"埃及": "EG", "egypt": "EG",
	"摩洛哥": "MA", "morocco": "MA",
	"南非": "ZA", "southafrica": "ZA",
	"肯尼亚": "KE", "kenya": "KE",
	"俄罗斯": "RU", "russia": "RU",
	"哈萨克斯坦": "KZ", "kazakhstan": "KZ",
	"英国": "GB", "uk": "GB", "unitedkingdom": "GB", "greatbritain": "GB",
	"爱尔兰": "IE", "ireland": "IE",
	"法国": "FR", "france": "FR",
	"德国": "DE", "germany": "DE",
	"意大利": "IT", "italy": "IT",
	"西班牙": "ES", "spain": "ES",
	"葡萄牙": "PT", "portugal": "PT",
	"荷兰": "NL", "netherlands": "NL",
	"比利时": "BE", "belgium": "BE",
	"瑞士": "CH", "switzerland": "CH",
	"奥地利": "AT", "austria": "AT",
	"希腊": "GR", "greece": "GR",
	"捷克": "CZ", "czechia": "CZ", "czechrepublic": "CZ",
	"匈牙利": "HU", "hungary": "HU",
	"波兰": "PL", "poland": "PL",
	"丹麦": "DK", "denmark": "DK",
	"瑞典": "SE", "sweden": "SE",
	"挪威": "NO", "norway": "NO",
	"芬兰": "FI", "finland": "FI",
	"冰岛": "IS", "iceland": "IS",
	"美国": "US", "usa": "US", "unitedstates": "US",
	"加拿大": "CA", "canada": "CA",
	"墨西哥": "MX", "mexico": "MX",
	"巴西": "BR", "brazil": "BR",
	"阿根廷": "AR", "argentina": "AR",
	"智利": "CL", "chile": "CL",
	"秘鲁": "PE", "peru": "PE",
	"澳大利亚": "AU", "澳洲": "AU", "australia": "AU",
	"新西兰": "NZ", "newzealand": "NZ",
}

// NormalizeCountry turns a country name or code into an uppercase ISO 3166-1
// alpha-2 code when it can. Unrecognised input is returned trimmed and
// uppercased so validation can reject it.
func NormalizeCountry(s string) string {
	s = strings.TrimSpace(s)
	key := strings.ToLower(strings.Join(strings.Fields(s), ""))
	if code, ok := countryAliases[key]; ok {
		return code
	}
	return strings.ToUpper(s)
}

func isCountryCode(s string) bool {
	if len(s) != 2 {
		return false
	}
	for _, r := range s {
		if r < 'A' || r > 'Z' {
			return false
		}
	}
	return true
}
