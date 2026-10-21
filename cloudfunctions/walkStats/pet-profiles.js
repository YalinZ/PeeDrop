const text = value => typeof value === 'string' ? value.trim()
  : (typeof value === 'number' && Number.isFinite(value) ? String(value) : '');

function petMetadata(profile) {
  return {
    profileId: text(profile._id),
    petId: text(profile.petId) || text(profile._id),
    petType: text(profile.petType) || text(profile.type),
    petBreed: text(profile.petBreed == null ? profile.breed : profile.petBreed)
  };
}

// 新统计按档案ID批量读取；旧统计通过已验证的 owner 关联，不能按名字猜。
async function enrichLeaderboardPets(db, rows, appid, hash) {
  if (!rows.length) return rows;
  const byId = new Map();
  const byOwner = new Map();
  const remember = profile => {
    byId.set(profile._id, profile);
    if (profile._openid) byOwner.set(hash(`${appid}:${profile._openid}`), profile);
  };
  const ids = [...new Set(rows.map(row => row.profileId || row.petId).filter(Boolean))];
  if (ids.length) {
    const result = await db.collection('pd_users').where({ _id: db.command.in(ids) }).limit(100).get();
    result.data.forEach(remember);
  }
  const find = row => {
    const profile = byId.get(row.profileId || row.petId);
    if (profile && (!row.owner || (profile._openid && hash(`${appid}:${profile._openid}`) === row.owner))) {
      return profile;
    }
    return byOwner.get(row.owner);
  };
  const missingOwners = new Set(rows.filter(row => !find(row)).map(row => row.owner).filter(Boolean));
  // 兼容原先没有 petId 的历史统计。首次命中后回填关联字段，后续走ID索引。
  let offset = 0;
  while (missingOwners.size) {
    const page = await db.collection('pd_users').orderBy('_id', 'asc').skip(offset).limit(100).get();
    page.data.forEach(profile => {
      remember(profile);
      if (profile._openid) missingOwners.delete(hash(`${appid}:${profile._openid}`));
    });
    if (page.data.length < 100) break;
    offset += page.data.length;
  }
  const enriched = rows.map(row => {
    const profile = find(row);
    return profile ? { ...row, ...petMetadata(profile) } : row;
  });
  await Promise.all(enriched.map(async (row, index) => {
    if (row.profileId && row.profileId !== rows[index].profileId) {
      try {
        await db.collection('pd_daily_stats').doc(row._id).update({ data: {
          profileId: row.profileId, petId: row.petId, petType: row.petType, petBreed: row.petBreed
        } });
      } catch (error) { console.warn('历史头像关联字段回填失败', error); }
    }
  }));
  return enriched;
}

module.exports = { petMetadata, enrichLeaderboardPets };
