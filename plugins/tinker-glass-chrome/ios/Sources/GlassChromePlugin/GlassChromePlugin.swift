import Foundation
import Capacitor
import SwiftUI
import UIKit

/**
 * Hosting controller that lets taps fall through empty chrome into the WebView.
 */
final class GlassChromeHostingController: UIHostingController<GlassChromeRoot> {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        view.isOpaque = false
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === view ? nil : hit
    }
}

/**
 * GlassChrome — mounts a SwiftUI Liquid Glass overlay above the Capacitor WebView.
 *
 * Floating chrome only (Apple guidance: glass for the navigation layer, not content):
 *   - Top-leading drawer toggle
 *   - Bottom-center AI / No AI mode nav (welcome feed)
 *
 * The WebView keeps owning product state; this plugin mirrors visibility and
 * forwards taps back as `drawerToggle` / `modeSelect` events.
 */
@objc(GlassChromePlugin)
public class GlassChromePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GlassChromePlugin"
    public let jsName = "GlassChrome"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "present", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dismiss", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setModeNav", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDrawerToggle", returnType: CAPPluginReturnPromise)
    ]

    private let model = GlassChromeModel()
    private var hostController: GlassChromeHostingController?
    private var presented = false

    public override func load() {
        model.onDrawerToggle = { [weak self] in
            self?.notifyListeners("drawerToggle", data: [:])
        }
        model.onModeSelect = { [weak self] mode in
            self?.notifyListeners("modeSelect", data: ["mode": mode.rawValue])
        }
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        var liquidGlass = false
        if #available(iOS 26.0, *) {
            liquidGlass = true
        }
        call.resolve([
            "available": true,
            "liquidGlass": liquidGlass
        ])
    }

    @objc func present(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let parent = self.bridge?.viewController else {
                call.reject("No bridge view controller")
                return
            }
            if self.presented {
                call.resolve(["presented": true])
                return
            }

            let root = GlassChromeRoot(model: self.model)
            let host = GlassChromeHostingController(rootView: root)
            host.view.frame = parent.view.bounds
            host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]

            parent.addChild(host)
            parent.view.addSubview(host.view)
            host.didMove(toParent: parent)

            self.hostController = host
            self.presented = true
            call.resolve(["presented": true])
        }
    }

    @objc func dismiss(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if let host = self.hostController {
                host.willMove(toParent: nil)
                host.view.removeFromSuperview()
                host.removeFromParent()
            }
            self.hostController = nil
            self.presented = false
            call.resolve(["dismissed": true])
        }
    }

    @objc func setModeNav(_ call: CAPPluginCall) {
        let modeStr = call.getString("mode") ?? "ai"
        let offline = call.getBool("offline") ?? false
        let visible = call.getBool("visible") ?? false

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.model.mode = (modeStr == "noai") ? .noai : .ai
            self.model.offline = offline
            self.model.modeNavVisible = visible
            call.resolve(["ok": true])
        }
    }

    @objc func setDrawerToggle(_ call: CAPPluginCall) {
        let expanded = call.getBool("expanded") ?? false
        let visible = call.getBool("visible") ?? true

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.model.drawerExpanded = expanded
            self.model.drawerVisible = visible
            call.resolve(["ok": true])
        }
    }
}
