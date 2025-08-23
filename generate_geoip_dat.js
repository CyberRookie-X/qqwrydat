const fs = require('fs');
const path = require('path');
const pinyin = require('pinyin');

// 汉字转拼音映射表
const pinyinMap = {
  // 运营商
  '电信': 'DX',
  '联通': 'LT',
  '移动': 'YD',
  '铁通': 'TT',
  '华数': 'HS',
  '未知': 'UN',
  
  // 省份
  '北京': 'BJ',
  '上海': 'SH',
  '天津': 'TJ',
  '重庆': 'CQ',
  '广东': 'GD',
  '浙江': 'ZJ',
  '江苏': 'JS',
  '山东': 'SD',
  '福建': 'FJ',
  '安徽': 'AH',
  '河南': 'HA',
  '湖北': 'HB',
  '湖南': 'HN',
  '江西': 'JX',
  '四川': 'SC',
  '陕西': 'SN',
  '山西': 'SX',
  '辽宁': 'LN',
  '吉林': 'JL',
  '黑龙江': 'HL',
  '河北': 'HE',
  '台湾': 'TW',
  '海南': 'HI',
  '甘肃': 'GS',
  '宁夏': 'NX',
  '青海': 'QH',
  '新疆': 'XJ',
  '西藏': 'XZ',
  '内蒙古': 'NM',
  '广西': 'GX',
  '贵州': 'GZ',
  '云南': 'YN',
  '香港': 'HK',
  '澳门': 'MO'
};

function getStandardCountryCode(countryName) {
  // 只处理中国数据
  if (countryName === "中国") {
    return "CN";
  }
  return null;
}

function getStandardRegionCode(regionName) {
  return pinyinMap[regionName] || regionName.substring(0, 3).toUpperCase();
}

function getIspCode(ispName) {
  if (ispName.length >= 2) {
    // 取前两个字
    const prefix = ispName.substring(0, 2);
    return pinyinMap[prefix] || 'UN';
  } else if (ispName.length === 1) {
    // 只有一个字的情况
    return pinyinMap[ispName] || 'UN';
  }
  return 'UN';
}

function getCityPinyin(cityName) {
  // 使用pinyin包处理城市名称拼音
  const pinyinArray = pinyin(cityName, {
    style: pinyin.STYLE_NORMAL, // 普通风格，即不带声调
    heteronym: false, // 不启用多音字模式
    segment: true // 启用分词
  });
  
  // 将二维数组扁平化并连接成字符串
  return pinyinArray.flat().join('');
}

function createCountryCodes(countryName, regionName, cityName, ipVersion = "4", ispDomain = "未知") {
  // 获取标准国家代码（只处理中国数据）
  const country = getStandardCountryCode(countryName);
  if (country === null) {
    return [];
  }
  
  // 获取标准地区代码
  const region = getStandardRegionCode(regionName);
  
  // 获取运营商代码
  const ispCode = getIspCode(ispDomain);
  
  const countryCodes = [];
  
  // 简化格式: IP版本-运营商代码-区域代码
  const simplifiedFormat = `${ipVersion}-${ispCode}-${region}`;
  countryCodes.push(simplifiedFormat);
  
  // 完整格式: IP版本-运营商代码-区域代码-城市完整拼音
  if (cityName && cityName !== regionName) {
    const cityPinyin = getCityPinyin(cityName);
    const fullFormat = `${ipVersion}-${ispCode}-${region}-${cityPinyin}`;
    countryCodes.push(fullFormat);
  }
  
  return countryCodes;
}

function parseIpdbEntry(dataEntry) {
  // ipdb数据条目格式: country_name|region_name|city_name|isp_domain
  const parts = dataEntry.split('\t');
  
  if (parts.length < 4) {
    return null;
  }
  
  return {
    country_name: parts[0] || "未知",
    region_name: parts[1] || "未知",
    city_name: parts[2] || parts[1],
    isp_domain: parts[3] || "未知"
  };
}

function writeString(str) {
  const strBuffer = Buffer.from(str, 'utf-8');
  const lenBuffer = Buffer.alloc(4);
  lenBuffer.writeUInt32LE(strBuffer.length, 0);
  return Buffer.concat([lenBuffer, strBuffer]);
}

function writeCidr(ip, prefixLen) {
  // 写入IPv4地址（4字节）
  const ipParts = ip.split('.');
  const ipBuffer = Buffer.alloc(4);
  if (ipParts.length === 4) {
    ipBuffer[0] = parseInt(ipParts[0]);
    ipBuffer[1] = parseInt(ipParts[1]);
    ipBuffer[2] = parseInt(ipParts[2]);
    ipBuffer[3] = parseInt(ipParts[3]);
  } else {
    // 默认写入4个0字节
    ipBuffer.fill(0);
  }
  
  // 写入prefix长度（4字节）
  const prefixBuffer = Buffer.alloc(4);
  prefixBuffer.writeUInt32LE(prefixLen, 0);
  
  return Buffer.concat([ipBuffer, prefixBuffer]);
}

function writeGeoIpEntry(countryCode, cidrs) {
  // 根据Landscape protobuf定义，GeoIP包含以下字段：
  // country_code: string类型 (tag=1)
  // cidr: repeated CIDR类型 (tag=2)
  // reverse_match: bool类型（默认为false）(tag=3)
  
  let buffer = Buffer.alloc(0);
  
  // 写入country_code字段 (tag=1, wire type=2 表示length-delimited)
  const countryBuffer = writeString(countryCode);
  const tag1 = Buffer.alloc(1);
  tag1.writeUInt8((1 << 3) | 2); // field number 1, wire type 2
  buffer = Buffer.concat([buffer, tag1, countryBuffer]);
  
  // 写入CIDR列表 (tag=2, wire type=2 表示length-delimited)
  for (const cidr of cidrs) {
    const cidrBuffer = writeCidr(cidr[0], cidr[1]);
    
    // CIDR是一个消息类型，需要先计算长度再写入
    const cidrLengthBuffer = Buffer.alloc(4);
    cidrLengthBuffer.writeUInt32LE(cidrBuffer.length, 0);
    
    const tag2 = Buffer.alloc(1);
    tag2.writeUInt8((2 << 3) | 2); // field number 2, wire type 2
    buffer = Buffer.concat([buffer, tag2, cidrLengthBuffer, cidrBuffer]);
  }
  
  // 写入reverse_match字段 (tag=3, wire type=0 表示varint)
  const tag3 = Buffer.alloc(1);
  tag3.writeUInt8((3 << 3) | 0); // field number 3, wire type 0
  const reverseMatchBuffer = Buffer.alloc(1);
  reverseMatchBuffer.writeUInt8(0); // false
  buffer = Buffer.concat([buffer, tag3, reverseMatchBuffer]);
  
  return buffer;
}

function generateGeoipDat(inputFile, outputFile) {
  // 检查输入文件是否存在
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file ${inputFile} does not exist.`);
    return;
  }
  
  // 读取输入数据
  const entries = new Map();
  
  // 判断是否为ipdb文件
  let lines;
  if (path.extname(inputFile) === '.ipdb') {
    // 对于ipdb文件，这里简化处理，实际应该解析二进制格式
    const data = fs.readFileSync(inputFile, 'utf-8');
    lines = data.split('\n').filter(line => line.trim() !== '');
  } else {
    // 读取普通文本文件
    const data = fs.readFileSync(inputFile, 'utf-8');
    lines = data.split('\n').filter(line => line.trim() !== '');
  }
  
  // 处理每一行数据
  for (const line of lines) {
    let country, region, city, ispDomain;
    
    if (path.extname(inputFile) === '.ipdb') {
      // 处理ipdb数据条目
      const entryData = line.trim();
      const parsedData = parseIpdbEntry(entryData);
      if (!parsedData) {
        continue;
      }
      
      country = parsedData.country_name;
      region = parsedData.region_name;
      city = parsedData.city_name;
      ispDomain = parsedData.isp_domain;
    } else {
      // 处理普通文本数据
      const parts = line.trim().split('|');
      if (parts.length < 4) {
        continue;
      }
      
      country = parts[0];
      region = parts[1];
      city = parts[2] || region;
      ispDomain = parts[3] || "未知";
    }
    
    // 只处理国家名称为中国的数据
    if (country !== "中国") {
      continue;
    }
    
    // 生成country_code列表 (默认为IPv4)
    const countryCodes = createCountryCodes(country, region, city, "4", ispDomain);
    
    // 跳过无法处理的数据
    if (countryCodes.length === 0) {
      continue;
    }
    
    // 为每个country_code添加条目
    for (const countryCode of countryCodes) {
      if (!entries.has(countryCode)) {
        entries.set(countryCode, []);
      }
      
      // 示例CIDR数据
      const exampleCidrs = [["192.168.1.0", 24]];
      entries.get(countryCode).push(...exampleCidrs);
    }
  }
  
  // 写入geoip.dat文件
  let fileBuffer = Buffer.alloc(0);
  
  // 写入条目数量
  const countBuffer = Buffer.alloc(4);
  countBuffer.writeUInt32LE(entries.size, 0);
  fileBuffer = Buffer.concat([fileBuffer, countBuffer]);
  
  // 写入每个条目
  for (const [countryCode, cidrs] of entries) {
    const entryBuffer = writeGeoIpEntry(countryCode, cidrs);
    fileBuffer = Buffer.concat([fileBuffer, entryBuffer]);
  }
  
  // 写入文件
  fs.writeFileSync(outputFile, fileBuffer);
  console.log(`Generated ${outputFile} with ${entries.size} entries`);
}

// 主函数
function main() {
  const args = process.argv.slice(2);
  const inputFile = args[0] || "qqwry.ipdb";
  const outputFile = args[1] || "geoip.dat";
  
  generateGeoipDat(inputFile, outputFile);
}

// 执行主函数
main();