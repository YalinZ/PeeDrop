const config = require('../config');
const AVATAR_BASE_URL = config.storageBaseUrl.replace(/\/?$/, '/') + 'avatars/';

const DOG_BREEDS = Object.freeze({
  '柯基': 'corgi',
  '金毛': 'golden',
  '雪纳瑞': 'schnauzer',
  '比熊': 'bichon',
  '泰迪': 'teddy',
  '边牧': 'border_collie',
  '秋田': 'akita',
  '田园犬': 'tianyuan'
});
const RANDOM_DOGS = Object.freeze(['random_dog_1.png', 'random_dog_2.png', 'random_dog_3.png']);
const CATS = Object.freeze(['cat_1.png', 'cat_2.png', 'cat_3.png']);

function text(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

// charCodeAt 同时兼容 ASCII 和中文 UTF-16 字符；每步保持无符号32位。
function hashPetIdentity(value) {
  const seed = text(value) || 'default-pet';
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function normalizePetType(value, legacyBreed) {
  const type = text(value).toLowerCase();
  if (['cat', '猫', '猫咪', '猫猫'].includes(type)) return 'cat';
  if (['dog', '狗', '狗狗', '犬'].includes(type)) return 'dog';
  // 仅在类型缺失时兼容旧项目曾把“猫”放进 breed 字段的数据。
  if (!type && ['猫', '猫咪', '猫猫'].includes(text(legacyBreed))) return 'cat';
  return 'dog';
}

function getPetAvatarUrl(petId, petType, petBreed) {
  const type = normalizePetType(petType);
  const breed = text(petBreed);
  const index = hashPetIdentity(petId) % 3;
  if (type === 'cat') return AVATAR_BASE_URL + CATS[index];
  if (Object.prototype.hasOwnProperty.call(DOG_BREEDS, breed)) {
    return AVATAR_BASE_URL + DOG_BREEDS[breed] + '.png';
  }
  return AVATAR_BASE_URL + RANDOM_DOGS[index];
}

// 数据入口统一适配旧字段；排行榜 _id 是每日统计ID，禁止用作头像种子。
function toPetProfile(raw, { useDocumentId = true } = {}) {
  const pet = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const name = text(pet.name);
  const breed = text(pet.petBreed == null ? pet.breed : pet.petBreed);
  const petType = normalizePetType(pet.petType == null ? pet.type : pet.petType, breed);
  const petId = text(pet.petId) || (useDocumentId ? text(pet._id) : '');
  return {
    ...pet, name, breed, petBreed: breed, petType, petId,
    avatarUrl: getPetAvatarUrl(petId || name, petType, breed)
  };
}

module.exports = { AVATAR_BASE_URL, getPetAvatarUrl, toPetProfile, normalizePetType, hashPetIdentity };
