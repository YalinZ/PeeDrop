# PeeDrop · 我留的味儿

一款围绕宠物和遛狗的微信小程序：在地图上留下宠物的活动标记，记录遛狗轨迹与里程，建立宠物档案，并查看每日遛狗排行榜。

## 扫码体验

用微信扫描下方小程序码，认识附近的毛孩子，一起出门走走！

<p align="center">
  <img src="docs/images/miniprogram-qr.jpg" alt="微信扫码体验 PeeDrop 我留的味儿" width="280" />
</p>

## 功能

- 地图浏览与活动标记、过期标记自动清理、地图点聚合。
- 遛狗轨迹与距离记录、本地进度恢复、跨日里程结算。
- 宠物档案、猫狗与品种头像匹配。
- 按北京时间统计的每日里程排行榜。
- 自定义底部导航、云存储图片按需加载与缓存。

## 目录

```text
miniprogram/                  页面、组件、服务和工具
cloudfunctions/walkStats/     身份、遛狗统计和排行榜
cloudfunctions/clearMarkers/  过期地图标记清理
scripts/                      初始化与检查脚本
tests/                        Node.js 自动化测试
docs/                         部署说明、功能文档与宣传二维码
project.config.example.json   微信开发者工具配置模板
```

仅收录业务代码、运行所需的本地图标、测试与必要文档；不包含依赖目录、原始素材备份、数据库导出或旧 quickstart 示例。

## 本地开发

需要微信开发者工具、Node.js 20 或以上，以及自己的小程序和微信云开发环境。

1. 克隆仓库，进入项目目录：

   ```sh
   git clone https://github.com/YalinZ/PeeDrop.git
   cd PeeDrop
   node scripts/setup-local.js
   ```

2. 在生成的 `project.config.json` 中填写**自己的小程序 AppID**。
3. 编辑生成的 `miniprogram/config.local.js`：

   | 字段 | 用途 |
   | --- | --- |
   | `resourceAppid` | 资源方小程序 AppID |
   | `resourceEnv` | 资源方云开发环境 ID |
   | `storageBaseUrl` | 云存储文件 ID 的完整根前缀，保留结尾 `/` |

   当前使用 `wx.cloud.Cloud` 跨账号资源环境对象。复用其他账号的环境时，需由资源方配置共享授权。配置与云存储前缀应指向同一个目标环境。模板占位符不能用于真实运行。

4. 用微信开发者工具导入项目根目录，按 [部署说明](docs/DEPLOYMENT.md) 创建集合、索引、云资源并部署云函数。
5. 真机验证定位授权、锁屏记录、打卡、档案和排行榜。后台定位能力需要相应接口权限，进程被系统终止后无法继续采样。

初始化脚本不覆盖已有配置。真实配置文件均被 Git 忽略；公开仓库仅提供占位符模板。云端插画和头像不在仓库中，需自行准备并上传；缺少这些资源时图片无法正常显示。

## 检查

```sh
node --test tests/*.test.js
node scripts/check-media-budget.js
git add .
node scripts/check-publication.js
```

测试使用微信 API / SDK 替身；本地通过不代表云端权限、部署和真机定位已验证。隐私检查针对 Git 暂存内容，提交前运行。

## 文档

- [部署与资源准备](docs/DEPLOYMENT.md)
- [配置与隐私说明](docs/PRIVACY.md)
- [遛狗记录与每日排行榜](docs/遛狗记录与每日排行榜修复说明.md)
- [地图气泡与点聚合](docs/地图气泡与点聚合说明.md)
- [宠物头像规则](docs/宠物头像重构说明.md)
- [UI 素材映射](docs/UI素材云存储迁移说明.md)

欢迎通过 [GitHub Issues](https://github.com/YalinZ/PeeDrop/issues) 反馈问题或提出建议。反馈时请去除个人信息、坐标、真实标识和访问凭据。
