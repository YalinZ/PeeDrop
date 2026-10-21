const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 自动获取当前云环境
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  try {
    // 找出所有 expireAt (过期时间) 小于当前当前时间的数据，并统统删掉
    const result = await db.collection('pd_markers').where({
      expireAt: _.lt(new Date())
    }).remove()

    console.log('清理完成，删除了', result.stats.removed, '条过期气泡')
    return { success: true, removed: result.stats.removed }
  } catch (err) {
    console.error('清理失败', err)
    return { success: false, err }
  }
}