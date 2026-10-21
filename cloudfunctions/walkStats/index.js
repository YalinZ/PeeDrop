const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { petMetadata, enrichLeaderboardPets } = require('./pet-profiles');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
const dayKey = time => new Date(time + 8 * 3600000).toISOString().slice(0, 10);

async function read(ref) {
  try {
    const result = await ref.get();
    // 兼容 SDK 的单文档对象/数组返回形式。
    return Array.isArray(result.data) ? (result.data[0] || null) : (result.data || null);
  } catch (error) {
    // 只将明确的“文档不存在”视为空；集合缺失、权限或网络异常必须抛出。
    const message = error.errMsg || error.message || '';
    if (/document.*(?:does not exist|not exist|不存在)/i.test(message)) return null;
    throw error;
  }
}

exports.main = async event => {
  const context = cloud.getWXContext();
  // 此项目使用跨账号资源环境；来源用户和来源 AppID 必须一起隔离。
  const openid = context.FROM_OPENID || context.OPENID;
  const appid = context.FROM_APPID || context.APPID;
  if (!openid || !appid) throw new Error('缺少微信身份');
  const owner = hash(`${appid}:${openid}`);
  if (event.action === 'identity') return { success: true, openid };
  if (event.action === 'leaderboard') {
    let day;
    let result;
    let pets;
    do {
      day = dayKey(Date.now()); // 不接受客户端传入“今天”。
      result = await db.collection('pd_daily_stats').where({
        appid, dayKey: day, distance: db.command.gt(0)
      }).orderBy('distance', 'desc').orderBy('_id', 'asc').limit(10).get();
      pets = await enrichLeaderboardPets(db, result.data, appid, hash);
    } while (day !== dayKey(Date.now())); // 查询本身跨午夜时重查。
    // petId 是稳定宠物ID；_id 仍是每日榜单ID，两者不能混用。
    return { success: true, dayKey: day, serverNow: Date.now(), data: pets.map(row => ({
      _id: row._id, petId: row.petId == null ? '' : row.petId, petType: row.petType || '',
      petBreed: row.petBreed == null ? row.breed : row.petBreed,
      name: row.name, breed: row.breed, todayDistance: row.distance
    })) };
  }
  if (event.action !== 'sync') throw new Error('未知操作');
  const session = event.session;
  const now = Date.now();
  if (!session || !/^w[a-z0-9]{10,60}$/.test(session.id) ||
      !Number.isSafeInteger(session.revision) || session.revision < 0 ||
      !['active', 'pending'].includes(session.status) ||
      !Number.isFinite(session.startedAt) || session.startedAt > now + 300000 ||
      !session.dailyDistances || typeof session.dailyDistances !== 'object') {
    throw new Error('无效遛狗数据');
  }
  const days = Object.keys(session.dailyDistances).sort();
  if (days.length > 31) throw new Error('单次遛狗不得超过31个统计日');
  for (const day of days) {
    const value = session.dailyDistances[day];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        day < dayKey(session.startedAt) || day > dayKey(now) ||
        !Number.isFinite(value) || value < 0 || value > 200000) {
      throw new Error('无效日期或里程');
    }
  }
  const profileResult = await db.collection('pd_users').where({ _openid: openid }).limit(1).get();
  if (!profileResult.data.length) throw new Error('请先建立狗狗档案');
  const profile = profileResult.data[0];
  const sessionId = hash(`${owner}:${session.id}`);
  await db.runTransaction(async transaction => {
    const sessionRef = transaction.collection('pd_walk_sessions').doc(sessionId);
    const old = await read(sessionRef);
    // 处理响应丢失重试、重复点击和乱序请求，结算后不可再修改。
    if (old && (old.status === 'finished' || old.revision >= session.revision)) return;
    const previous = old ? old.dailyDistances : {};
    for (const day of Object.keys(previous)) {
      if (!(day in session.dailyDistances) || session.dailyDistances[day] < previous[day]) {
        throw new Error('累计里程不可回退');
      }
    }
    // 事务回调中只读写数据库，不发送网络请求或执行客户端副作用。
    for (const day of days) {
      const delta = session.dailyDistances[day] - (previous[day] || 0);
      if (delta <= 0) continue;
      const ref = transaction.collection('pd_daily_stats').doc(hash(`${owner}:${day}`));
      const stat = await read(ref);
      await ref.set({ data: {
        appid, owner, dayKey: day, ...petMetadata(profile),
        name: profile.name || '神秘修狗', breed: profile.breed || '',
        distance: (stat ? stat.distance : 0) + delta, updatedAt: db.serverDate()
      } });
    }
    await sessionRef.set({ data: {
      appid, owner, revision: session.revision,
      status: session.status === 'pending' ? 'finished' : 'active',
      startedAt: session.startedAt, dailyDistances: session.dailyDistances,
      updatedAt: db.serverDate()
    } });
  });
  return { success: true };
};
