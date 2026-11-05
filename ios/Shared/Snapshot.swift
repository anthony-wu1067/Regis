import Foundation

/// What the web app hands the shell (see snapshotData() in the page). Both the app and the widgets read it.
struct RegisSnapshot: Codable {
    struct Event: Codable, Identifiable {
        var title: String
        var start: String
        var end: String
        var allDay: Bool?
        var loc: String?
        var id: String { start + title }
        var startDate: Date? { RegisSnapshot.parse(start) }
        var endDate: Date? { RegisSnapshot.parse(end) }
    }
    struct Todo: Codable, Identifiable {
        var title: String
        var due: String?
        var overdue: Bool?
        var id: String { title + (due ?? "") }
    }
    var v: Int
    var ts: String
    var events: [Event]
    var todos: [Todo]
    var todoCount: Int
    var unread: Int?

    static func parse(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    static let empty = RegisSnapshot(v: 1, ts: "", events: [], todos: [], todoCount: 0, unread: nil)
}

/// Shared storage between the app and its widgets.
/// AltStore re-signs the app with a different App Group id, so we read the real one from Info.plist (ALTAppGroups)
/// and only fall back to the default when running from Xcode.
enum RegisStore {
    static var groupID: String {
        if let list = Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String], let first = list.first { return first }
        return "group.app.regis.mobile"
    }
    static var defaults: UserDefaults { UserDefaults(suiteName: groupID) ?? .standard }

    static func save(json: String) { defaults.set(json, forKey: "snapshot") }

    static func load() -> RegisSnapshot {
        guard let s = defaults.string(forKey: "snapshot"), let d = s.data(using: .utf8),
              let snap = try? JSONDecoder().decode(RegisSnapshot.self, from: d) else { return .empty }
        return snap
    }
}
