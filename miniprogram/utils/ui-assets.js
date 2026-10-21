const config = require('../config');
const UI_BASE_URL = config.storageBaseUrl.replace(/\/?$/, '/') + 'UI/';
const FILES = Object.freeze({
  paw: '01-paw-button.png', dog: '02-dog-floppy-ears.png', cat: '03-cat-gray.png',
  corgi: '04-dog-corgi.png', poodle: '05-dog-poodle.png', bone: '06-bone.png',
  tennisBall: '07-tennis-ball.png', trophy: '08-trophy.png', heart: '09-heart.png',
  smallHeart: '10-small-heart.png', star: '11-star.png'
});
const UI_ASSETS = Object.freeze(Object.keys(FILES).reduce((assets, key) => {
  assets[key] = UI_BASE_URL + FILES[key];
  return assets;
}, {}));
module.exports = { UI_BASE_URL, UI_ASSETS };
