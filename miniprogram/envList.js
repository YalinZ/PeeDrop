

const envList = [
  {
    envId: require('./config').resourceEnv,
    alias: 'prod'
  }
];

const isMac = false;

module.exports = {
  envList,
  isMac
};
