import AppKit
import Foundation

// Canonical local launcher. Native application termination uses AppKit's normal
// quit request; no signals, forceTerminate, shell interpolation or AppleScript.
final class DevelopmentEntry: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let config = Bundle.main.infoDictionary!
    var root: URL { URL(fileURLWithPath: config["YijieProjectRoot"] as! String) }
    var nativeURL: URL { root.appendingPathComponent(".local/development/target/debug/yijie-desktop") }
    var native: NSRunningApplication? {
        NSWorkspace.shared.runningApplications.first { $0.executableURL?.standardizedFileURL == nativeURL.standardizedFileURL }
    }
    var process: Process?
    var log: FileHandle?
    var window: NSWindow!
    var label: NSTextField!
    var spinner: NSProgressIndicator!
    var statusItem: NSStatusItem!
    var timer: Timer?
    var starting = true
    var seenNative = false
    var stopping = false
    var stopRequested = false
    var requestedPID: pid_t?
    var deferredTermination = false
    var quitDeadline: Date?
    var done = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        ProcessInfo.processInfo.disableSuddenTermination()
        ProcessInfo.processInfo.disableAutomaticTermination("易界及其本地服务需要正常退出")
        let menu = NSMenu()
        menu.addItem(withTitle: "打开易界", action: #selector(showClient), keyEquivalent: "")
        menu.addItem(withTitle: "查看启动日志", action: #selector(showLog), keyEquivalent: "")
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "退出易界", action: #selector(quit), keyEquivalent: "q")
        for item in menu.items { item.target = self }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "易界"
        statusItem.menu = menu
        let main = NSMenu()
        let mainItem = NSMenuItem()
        mainItem.submenu = menu.copy() as? NSMenu
        main.addItem(mainItem)
        NSApp.mainMenu = main
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 430, height: 160), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "易界"
        window.isReleasedWhenClosed = false
        window.delegate = self
        label = NSTextField(wrappingLabelWithString: "正在启动易界…")
        label.font = .systemFont(ofSize: 15)
        label.frame = NSRect(x: 58, y: 50, width: 346, height: 60)
        spinner = NSProgressIndicator(frame: NSRect(x: 22, y: 71, width: 22, height: 22))
        spinner.style = .spinning
        spinner.startAnimation(nil)
        window.contentView?.addSubview(label)
        window.contentView?.addSubview(spinner)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        timer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer!, forMode: .common)
        RunLoop.main.add(timer!, forMode: .modalPanel)
        if native != nil {
            seenNative = true
            // Attach to a client started from a terminal, using the same service
            // controller. The existing client is never relaunched or replaced.
            runPython(script: root.deletingLastPathComponent().appendingPathComponent("yijie-infra/scripts/workflow-session.py"), arguments: ["ensure"]) { code in
                self.starting = false
                if code != 0 { self.fail("服务检查未通过，请查看启动日志。") }
                else { self.showClient() }
            }
        } else {
            startDocker()
        }
    }

    func startDocker() {
        label.stringValue = "正在准备本地服务…"
        let docker = URL(fileURLWithPath: config["YijieDockerApp"] as! String)
        if NSRunningApplication.runningApplications(withBundleIdentifier: "com.docker.docker").isEmpty {
            let options = NSWorkspace.OpenConfiguration()
            options.activates = false
            NSWorkspace.shared.openApplication(at: docker, configuration: options) { _, error in
                DispatchQueue.main.async {
                    if error != nil { self.fail("Docker 未能启动，请正常打开 Docker 后再点击易界。") }
                    else { self.waitForDocker() }
                }
            }
        } else { waitForDocker() }
    }

    func waitForDocker() {
        let docker = URL(fileURLWithPath: config["YijieDockerApp"] as! String).appendingPathComponent("Contents/Resources/bin/docker")
        let socket = "unix://" + FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".docker/run/docker.sock").path
        DispatchQueue.global(qos: .userInitiated).async {
            let deadline = Date().addingTimeInterval(180)
            var ready = false
            repeat {
                let probe = Process()
                probe.executableURL = docker
                probe.arguments = ["--host", socket, "info", "--format", "{{.ServerVersion}}"]
                probe.standardOutput = FileHandle.nullDevice
                probe.standardError = FileHandle.nullDevice
                do { try probe.run(); probe.waitUntilExit(); ready = probe.terminationStatus == 0 }
                catch { break }
                if !ready { Thread.sleep(forTimeInterval: 1) }
            } while !ready && Date() < deadline
            DispatchQueue.main.async {
                if self.stopRequested { self.finish(); return }
                guard ready else { self.fail("Docker 尚未就绪，请查看 Docker 状态后重新打开易界。"); return }
                self.label.stringValue = "正在启动服务并加载易界…"
                self.runPython(script: self.root.appendingPathComponent("scripts/development-client.py"), arguments: ["start"]) { code in
                    self.starting = false
                    if code == 0 { self.finish() }
                    else { self.fail("启动或退出检查未完成，数据已保留。请查看启动日志。") }
                }
            }
        }
    }

    func runPython(script: URL, arguments: [String], completion: @escaping (Int32) -> Void) {
        do {
            let output = root.appendingPathComponent(".local/development/entry.log")
            if !FileManager.default.fileExists(atPath: output.path) {
                FileManager.default.createFile(atPath: output.path, contents: nil, attributes: [.posixPermissions: 0o600])
            }
            log = try FileHandle(forWritingTo: output)
            try log?.seekToEnd()
            let child = Process()
            child.executableURL = URL(fileURLWithPath: config["YijiePython"] as! String)
            child.arguments = ["-B", script.path] + arguments
            child.currentDirectoryURL = root
            child.environment = ["HOME": FileManager.default.homeDirectoryForCurrentUser.path, "PATH": config["YijieToolPath"] as! String, "PYTHONUNBUFFERED": "1"]
            child.standardOutput = log
            child.standardError = log
            child.terminationHandler = { ended in
                DispatchQueue.main.async {
                    self.process = nil
                    try? self.log?.close()
                    self.log = nil
                    completion(ended.terminationStatus)
                }
            }
            process = child
            try child.run()
        } catch { process = nil; fail("启动入口不可用，请查看项目目录和启动日志。") }
    }

    func tick() {
        if let app = native {
            if !seenNative {
                seenNative = true
                window.orderOut(nil)
                NSApp.setActivationPolicy(.accessory)
                app.activate(options: [.activateAllWindows])
            }
            if stopRequested && requestedPID != app.processIdentifier {
                requestedPID = app.processIdentifier
                if !app.terminate() { fail("易界暂时不能退出，请在客户端中正常退出。") }
            }
        } else if seenNative && process == nil && !stopping && !done {
            // An attached terminal client has its own parent. Wait for all of its
            // children to finish; the controller independently rejects live Host.
            stopping = true
            status("正在结束本地服务…")
            runPython(script: root.deletingLastPathComponent().appendingPathComponent("yijie-infra/scripts/workflow-session.py"), arguments: ["stop"]) { code in
                if code == 0 { self.finish() }
                else { self.fail("本地服务仍需正常退出，请查看启动日志。") }
            }
        }
        if deferredTermination, let deadline = quitDeadline, Date() > deadline {
            deferredTermination = false
            NSApp.reply(toApplicationShouldTerminate: false)
            status("清理仍在进行，已暂缓退出。完成后可继续重启电脑。")
        }
    }

    func status(_ text: String) {
        label.stringValue = text
        window.makeKeyAndOrderFront(nil)
    }

    func fail(_ text: String) {
        starting = false
        done = true
        spinner.stopAnimation(nil)
        if deferredTermination { deferredTermination = false; NSApp.reply(toApplicationShouldTerminate: false) }
        status(text)
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    func finish() {
        done = true
        if deferredTermination { deferredTermination = false; NSApp.reply(toApplicationShouldTerminate: true) }
        else { NSApp.terminate(nil) }
    }

    @objc func showClient() {
        if let app = native {
            window.orderOut(nil)
            NSApp.setActivationPolicy(.accessory)
            app.activate(options: [.activateAllWindows])
        } else { window.makeKeyAndOrderFront(nil) }
    }
    @objc func showLog() { NSWorkspace.shared.open(root.appendingPathComponent(".local/development/entry.log")) }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showClient(); return true }
    func windowShouldClose(_ sender: NSWindow) -> Bool { quit(); return false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if done { return .terminateNow }
        stopRequested = true
        status("正在正常退出易界并结束本地服务…")
        if !seenNative && starting {
            // Cancel logout instead of letting macOS time out and interrupt a build.
            label.stringValue = "正在完成启动；完成后将正常退出。请稍后再重启电脑。"
            return .terminateCancel
        }
        deferredTermination = true
        quitDeadline = Date().addingTimeInterval(90)
        tick()
        return .terminateLater
    }
}

let application = NSApplication.shared
let delegate = DevelopmentEntry()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
