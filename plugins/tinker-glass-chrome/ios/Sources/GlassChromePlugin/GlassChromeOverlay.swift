import SwiftUI

/// Shared chrome state driven from the Capacitor plugin / WebView bridge.
final class GlassChromeModel: ObservableObject {
    enum Mode: String {
        case ai
        case noai
    }

    @Published var mode: Mode = .ai
    @Published var offline: Bool = false
    @Published var modeNavVisible: Bool = false
    @Published var drawerExpanded: Bool = false
    @Published var drawerVisible: Bool = true

    var onDrawerToggle: (() -> Void)?
    var onModeSelect: ((Mode) -> Void)?
}

/// Root overlay: floating drawer toggle (top-leading) + AI / No AI mode nav (bottom-center).
/// Uses Liquid Glass on iOS 26+; falls back to ultra-thin material on earlier OS versions.
struct GlassChromeRoot: View {
    @ObservedObject var model: GlassChromeModel

    /// Matches `--color-accent-strong` / CTA indigo in the web design tokens.
    private let accent = Color(red: 99 / 255, green: 102 / 255, blue: 241 / 255)
    /// Matches `--color-foreground` warm ink.
    private let ink = Color(red: 45 / 255, green: 42 / 255, blue: 38 / 255)
    /// Matches `--color-muted`.
    private let muted = Color(red: 111 / 255, green: 106 / 255, blue: 101 / 255)

    var body: some View {
        ZStack {
            if model.drawerVisible && !model.drawerExpanded {
                VStack {
                    HStack {
                        drawerToggle
                            .padding(.leading, 12)
                            .padding(.top, 12)
                        Spacer(minLength: 0)
                    }
                    Spacer(minLength: 0)
                }
            }

            if model.modeNavVisible && !model.drawerExpanded {
                VStack {
                    Spacer(minLength: 0)
                    modeNav
                        .padding(.bottom, 12)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var drawerToggle: some View {
        Button(action: { model.onDrawerToggle?() }) {
            Image(systemName: "line.3.horizontal")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(ink)
                .frame(width: 48, height: 48)
        }
        .buttonStyle(PlainButtonStyle())
        .accessibility(label: Text("Open sidebar"))
        .modifier(LiquidGlassCircle())
    }

    private var modeNav: some View {
        VStack(spacing: 0) {
            HStack(spacing: 2) {
                modeSegment(
                    title: "AI",
                    systemImage: "sparkle",
                    selected: model.mode == .ai,
                    disabled: model.offline
                ) {
                    model.onModeSelect?(.ai)
                }
                modeSegment(
                    title: "No AI",
                    systemImage: "square.and.pencil",
                    selected: model.mode == .noai,
                    disabled: false
                ) {
                    model.onModeSelect?(.noai)
                }
            }
            .padding(3)
            .modifier(LiquidGlassCapsule())

            if model.offline {
                Text("You're offline")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16)
                    .padding(.top, 5)
                    .padding(.bottom, 4)
                    .background(
                        Color(red: 45 / 255, green: 42 / 255, blue: 38 / 255).opacity(0.85)
                    )
                    .clipShape(Capsule())
                    .padding(.top, -4)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibility(label: Text("Writing mode"))
    }

    private func modeSegment(
        title: String,
        systemImage: String,
        selected: Bool,
        disabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .semibold))
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
            }
            .foregroundColor(selected ? Color.white : muted)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
                Capsule().fill(selected ? accent : Color.clear)
            )
        }
        .buttonStyle(PlainButtonStyle())
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .accessibility(label: Text(title))
        .accessibility(addTraits: selected ? .isSelected : [])
    }
}

// MARK: - Liquid Glass modifiers

/// Circular Liquid Glass (drawer toggle). Falls back to ultra-thin material pre-iOS 26.
private struct LiquidGlassCircle: ViewModifier {
    func body(content: Content) -> some View {
        Group {
            if #available(iOS 26.0, *) {
                content
                    .glassEffect(.regular.interactive(), in: .circle)
            } else {
                content
                    .background(.ultraThinMaterial, in: Circle())
                    .overlay(Circle().stroke(Color.white.opacity(0.22), lineWidth: 0.5))
            }
        }
    }
}

/// Capsule Liquid Glass (mode nav). Falls back to ultra-thin material pre-iOS 26.
private struct LiquidGlassCapsule: ViewModifier {
    func body(content: Content) -> some View {
        Group {
            if #available(iOS 26.0, *) {
                content
                    .glassEffect(.regular.interactive(), in: .capsule)
            } else {
                content
                    .background(.ultraThinMaterial, in: Capsule())
                    .overlay(Capsule().stroke(Color.primary.opacity(0.08), lineWidth: 0.5))
                    .shadow(color: Color.black.opacity(0.12), radius: 10, y: 4)
            }
        }
    }
}
