# 排查报告：手机方向锁定被自动关闭

> 日期：2026-11-19
> 设备：小米 14（HyperOS / MIUI），1200x2670，无线 adb
> 涉及应用：水獭音乐 otter-music（com.otterhub.music）v2.7.16 debug

## 一、现象

用户发现手机的「方向锁定」被关闭（即系统自动旋转被打开，`Settings.System.ACCELEROMETER_ROTATION = 1`），且时间上与「每次通过 adb 安装 app」高度相关。

## 二、时间线（2026-11-19）

| 时间  | accelerometer_rotation | 事件                                                           |
| ----- | ---------------------- | -------------------------------------------------------------- |
| 16:40 | 0（锁定）              | 安装 APK 前实测                                                |
| 16:49 | 1（被关）              | 用户发现并质问                                                 |
| 16:50 | 0                      | agent 执行 `settings put system accelerometer_rotation 0` 恢复 |
| 16:54 | 1（又被改回）          | 此时手机处于横持状态，系统已旋转到横屏                         |
| 16:58 | 0                      | 再次恢复，之后多次检查保持稳定                                 |
| 17:03 | 1                      | **复现实验**：仅启动 app，设置再次被改为 1                     |

## 三、隔离实验（关键证据）

每步前后各读一次 `settings get system accelerometer_rotation`：

| 实验                                      | 结果                  | 结论                                                                |
| ----------------------------------------- | --------------------- | ------------------------------------------------------------------- |
| 仅执行 `adb install -r`（无任何其他操作） | 0 → 0                 | **安装命令本身不触发**                                              |
| force-stop 后仅启动 app（monkey 拉起）    | 0 → 1，两次复现，必现 | **当次误判为启动 app 触发（实际是 monkey 命令触发，见第八节订正）** |

logcat 佐证：app 启动后 `sensors-hal` 立即出现 accelerometer 传感器订阅日志（对应系统旋转监听开启），与自动旋转被打开的行为一致。

## 四、嫌疑排除清单

1. **adb 命令**：本次会话所有命令可完整列举，仅有的两条 `settings put` 均为恢复 0；近一周历史会话记录中检索不到任何改旋转设置的命令。
2. **app 原生层（Java/Kotlin）**：全量搜索无任何写 `Settings.System` / `ACCELEROMETER_ROTATION` 的代码。`StayAwakeTileService`（「不锁屏」磁贴）只写 `Settings.Global.STAY_ON_WHILE_PLUGGED_IN`，与旋转无关。
3. **app web 层**：打包产物中的 `accelerometer` 字样仅为「关于手机」页的传感器状态展示字段（`accelerometer: false`），非写设置逻辑；无任何调用 ScreenOrientation 写系统设置的代码。
4. **方向请求拦截**：v2.7.11 已把插件的 `SCREEN_ORIENTATION_UNSPECIFIED` 拦截改写为 `SCREEN_ORIENTATION_USER`（提交 2296326，"修复横屏退出清掉方向锁"），逻辑干净。
5. **WRITE_SECURE_SETTINGS 权限**：manifest 声明了该权限（v2.7.11 引入，供「不锁屏」磁贴写 Global 设置），但代码中无任何针对旋转设置的写入。
6. **capacitor.config.json**：git diff 仅为缩进差异，无方向相关配置。

## 五、结论

**启动水獭音乐 app 这一动作本身，会触发 HyperOS/MIUI 在系统层面把「自动旋转」打开（accelerometer_rotation 0→1）。**

- 触发源：app 启动，推测与媒体会话恢复 / 横屏沉浸模式的历史状态有关；
- 性质：系统级联动行为，必现；
- 不是 adb 安装命令、不是 agent 的设置命令、也不是 app 任何一层代码的显式写入（app 侧均为只读或无关写入）；
- 由于该行为发生在系统框架层，app 代码与 adb 侧均无法根治，只能流程性恢复。

补充观察：横屏期间 screencap 截图为 2670x1200，属系统自动旋转的正常表现（app 为 `SCREEN_ORIENTATION_USER` 跟随系统），非 app 强制横屏。

## 六、对策

1. **流程性恢复（已固化为 agent 全局记忆规则）**：每次安装 / 启动验证收尾后，自动执行
   ```bash
   adb shell settings put system accelerometer_rotation 0
   ```
   恢复方向锁定，并向用户告知。
2. **可选的进一步排查（如需根治）**：
   - 观察是否与「上次退出时播放器处于横屏沉浸模式」有关：退出前先手动退出横屏，再安装/启动，看是否仍触发；
   - 尝试关闭 app 的自启动 / 后台权限后再实验，定位是否媒体会话恢复引起；
   - 在 HyperOS 设置中查找针对该 app 的屏幕方向偏好记录并清除。

## 七、相关文件

- 全局记忆规则：`~/.workbuddy/user-…/MEMORY.md`（真机 / adb 操作一节）
- 工作日志：`.workbuddy/memory/2026-11-19.md`
- 相关代码：`android/app/src/main/java/com/otterhub/music/MainActivity.java`（setRequestedOrientation 拦截）、`src/hooks/useLandscapeMode.ts`（横屏沉浸模式）

## 八、真因订正（2026-11-25 复查）

2026-11-25 在同款真机（小米 14，v2.7.23）补做精确对照实验，推翻第五节「启动水獭音乐本身触发」的推测，定位到真正根因是 **`adb shell monkey` 命令本身**：

| 实验                                                                                                       | 结果      | 说明                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------- |
| `am force-stop com.otterhub.music` 后 `am start -n com.otterhub.music/.MainActivity`                       | 0 → **0** | 正常启动水獭音乐完全不会动方向锁定                                                           |
| `am force-stop com.otterhub.music` 后 `monkey -p com.otterhub.music -c android.intent.category.LAUNCHER 1` | 0 → **1** | 触发 `ActivityTaskManager: setActivityController(..., imAMonkey=true)`，系统自动打开自动旋转 |
| `monkey -p com.android.settings -c android.intent.category.LAUNCHER 1`                                     | 0 → **1** | 即使拉起系统「设置」而非水獭音乐，同样立即把 `accelerometer_rotation` 改为 1                 |

### 为什么每次「装完打开」都会复现

1. 装机流程（`.workbuddy/memory/MEMORY.md` 第 6 步）在每次 `adb install -r` 后使用 `adb shell monkey` 拉起 app 清缓存；
2. 11-19 的排查实验本身也是用 `monkey` 拉起做的测试，把 `monkey` 的副作用误判成了 app 启动行为；之后流程重写时漏掉了 `settings put system accelerometer_rotation 0` 兜底，导致问题复发。

### 根治方案

- 所有装机/调试启动统一改用 `adb shell am start -n com.otterhub.music/.MainActivity`，**禁止使用 `adb shell monkey` 拉起应用**。
- 已同步更新 `.workbuddy/memory/MEMORY.md` 的装机规范。
