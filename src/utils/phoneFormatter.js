/**
 * 手机号码格式化工具
 * 根据 Baileys 文档要求，手机号码必须是 E.164 格式且不带加号
 * 例如: +1 (234) 567-8901 -> 12345678901
 */

/**
 * 将手机号码格式化为 E.164 格式（不带加号）
 * @param {string} phoneNumber - 输入的手机号码
 * @returns {string} - 格式化后的手机号码
 */
function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    throw new Error('手机号码不能为空');
  }

  // 移除所有非数字字符
  let cleanNumber = phoneNumber.replace(/\D/g, '');
  
  // 如果号码以1开头且长度为11位，可能是美国号码
  // 如果号码以86开头，可能是中国号码
  // 这里可以根据需要添加更多国家代码的处理逻辑
  
  if (cleanNumber.length === 0) {
    throw new Error('无效的手机号码格式');
  }

  // 确保号码长度合理（通常在7-15位之间）
  // if (cleanNumber.length < 7 || cleanNumber.length > 15) {
  //   throw new Error('手机号码长度不符合国际标准');
  // }

  return cleanNumber;
}

/**
 * 验证手机号码格式是否正确
 * @param {string} phoneNumber - 手机号码
 * @returns {boolean} - 是否有效
 */
function isValidPhoneNumber(phoneNumber) {
  try {
    const formatted = formatPhoneNumber(phoneNumber);
    return formatted.length >= 7 && formatted.length <= 15;
  } catch (error) {
    return false;
  }
}

/**
 * 根据常见格式智能格式化手机号码
 * @param {string} phoneNumber - 输入的手机号码
 * @returns {string} - 格式化后的手机号码
 */
function smartFormatPhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    throw new Error('phone number is required');
  }
  let cleanNumber = phoneNumber.replace(/\D/g, '');
  return formatPhoneNumber(cleanNumber);
}

module.exports = {
  formatPhoneNumber,
  isValidPhoneNumber,
  smartFormatPhoneNumber
}; 