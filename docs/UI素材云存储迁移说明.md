# UI素材已迁移到云存储

云目录严格为大写UI/：

cloud://YOUR_CLOUD_ENV_ID.YOUR_STORAGE_BUCKET/UI/

## 统一映射

miniprogram/utils/ui-assets.js包含全部11张素材：

- paw → 01-paw-button.png
- dog → 02-dog-floppy-ears.png
- cat → 03-cat-gray.png
- corgi → 04-dog-corgi.png
- poodle → 05-dog-poodle.png
- bone → 06-bone.png
- tennisBall → 07-tennis-ball.png
- trophy → 08-trophy.png
- heart → 09-heart.png
- smallHeart → 10-small-heart.png
- star → 11-star.png

仅加载当前页面原本使用的素材；未使用的素材也已登记，不会为了迁移新增装饰或改变布局。

## 已接入

底部导航中间爪子按钮、地图打卡面板、个人页插画与排行榜装饰、旧示例页星星图片，均已改用uiImages数据绑定。WXSS不变，加载前通过wx:if避免向image传入空地址。

四张导航图标tab_map.png、tab_map_active.png、tab_user.png、tab_user_active.png仍在本地且未修改。地图原生marker也继续使用其中的tab_map.png。

宠物头像仍使用avatars/目录，不与UI插画混用。

## 加载方式

使用当前项目的跨账号getApp().cloud实例，等待cloudInitPromise，再调用getTempFileURL。页面得到HTTPS链接后绑定图片。

UI图片复用头像服务的批量请求、在途去重和最多5分钟内存缓存。不会把临时链接写入数据库或长期存储。页面重新显示时重新检查缓存；单个文件失败不会影响同批其他文件。图片渲染错误会强制重新解析一次，避免错误循环；页面销毁后不再更新data。

## 接下来

1. 保存并编译。
2. 手机预览检查爪子按钮、地图骨头、个人页狗狗插画、奖杯和空状态猫咪。
3. 若素材缺失，查看控制台“UI素材读取失败”及文件返回错误，核对大写UI目录、完整文件名、目标环境、跨账号共享与读取权限。
4. 确认后上传新前端版本并检查代码质量。不需要部署云函数或修改数据库。

本地测试不能确认云文件实际存在或权限已经开放；这些需要通过真实小程序访问验收。
