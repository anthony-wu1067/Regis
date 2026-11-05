import WidgetKit
import SwiftUI

// MARK: - Timeline

struct RegisEntry: TimelineEntry {
    let date: Date
    let snap: RegisSnapshot
}

struct RegisProvider: TimelineProvider {
    func placeholder(in context: Context) -> RegisEntry {
        RegisEntry(date: Date(), snap: RegisSnapshot(v: 1, ts: "", events: [
            .init(title: "Team sync", start: ISO8601DateFormatter().string(from: Date().addingTimeInterval(1800)), end: ISO8601DateFormatter().string(from: Date().addingTimeInterval(5400)), allDay: false, loc: "Room 4")
        ], todos: [.init(title: "Call the dentist", due: "", overdue: false), .init(title: "Send invoice", due: "", overdue: true)], todoCount: 2, unread: 5))
    }
    func getSnapshot(in context: Context, completion: @escaping (RegisEntry) -> Void) {
        let s = RegisStore.load()
        completion(s.events.isEmpty && s.todos.isEmpty ? placeholder(in: context) : RegisEntry(date: Date(), snap: s))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<RegisEntry>) -> Void) {
        let snap = RegisStore.load(), now = Date()
        // One entry per upcoming change (an event starting or ending) so "next up" rolls forward by itself.
        var dates: [Date] = [now]
        for e in snap.events {
            if let s = e.startDate, s > now { dates.append(s) }
            if let en = e.endDate, en > now { dates.append(en) }
        }
        dates = Array(Set(dates)).sorted().prefix(12).map { $0 }
        let entries = dates.map { RegisEntry(date: $0, snap: snap) }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(15 * 60))))
    }
}

// MARK: - Helpers

extension RegisEntry {
    /// Events that haven't finished as of this entry's date.
    var upcoming: [RegisSnapshot.Event] {
        snap.events.filter { ($0.endDate ?? .distantFuture) > date }
    }
    var staleNote: String? {
        guard let t = RegisSnapshot.parse(snap.ts) else { return snap.ts.isEmpty ? "Open Regis to load" : nil }
        return date.timeIntervalSince(t) > 6 * 3600 ? "Open Regis to refresh" : nil
    }
}

let regisBG = LinearGradient(colors: [Color(red: 0.16, green: 0.10, blue: 0.30), Color(red: 0.04, green: 0.04, blue: 0.09)], startPoint: .topLeading, endPoint: .bottomTrailing)
let regisAccent = Color(red: 0.72, green: 0.62, blue: 1.0)

extension View {
    /// iOS 17 requires containerBackground; iOS 16 uses a plain background.
    @ViewBuilder func regisBackground() -> some View {
        if #available(iOS 17.0, *) { self.containerBackground(for: .widget) { regisBG } }
        else { self.padding().background(regisBG) }
    }
}

struct EventRow: View {
    let e: RegisSnapshot.Event
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(e.title).font(.subheadline.weight(.semibold)).lineLimit(1)
            if e.allDay == true { Text("All day").font(.caption).foregroundStyle(.secondary) }
            else if let s = e.startDate, let en = e.endDate {
                Text("\(s.formatted(date: .omitted, time: .shortened)) – \(en.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Next event

struct NextEventView: View {
    @Environment(\.widgetFamily) var family
    let entry: RegisEntry
    var body: some View {
        let evs = entry.upcoming
        Group {
            switch family {
            case .accessoryRectangular:
                VStack(alignment: .leading) {
                    Text("Next up").font(.caption2).foregroundStyle(.secondary)
                    if let e = evs.first { Text(e.title).font(.headline).lineLimit(1); if let s = e.startDate { Text(s, style: .time).font(.caption) } }
                    else { Text("Nothing scheduled").font(.headline) }
                }
            default:
                VStack(alignment: .leading, spacing: 6) {
                    Text("NEXT UP").font(.caption2.weight(.bold)).foregroundStyle(regisAccent).tracking(1.5)
                    if evs.isEmpty {
                        Text("Nothing else on the calendar").font(.headline)
                    } else {
                        ForEach(Array(evs.prefix(family == .systemSmall ? 1 : 3))) { e in
                            VStack(alignment: .leading, spacing: 1) {
                                if family == .systemSmall, let s = e.startDate { Text(s, style: .relative).font(.title3.weight(.bold)).foregroundStyle(regisAccent) }
                                EventRow(e: e)
                                if family == .systemSmall, let l = e.loc, !l.isEmpty { Text(l).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                            }
                        }
                    }
                    Spacer(minLength: 0)
                    if let n = entry.staleNote { Text(n).font(.caption2).foregroundStyle(.secondary) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .widgetURL(URL(string: "regis://open"))
    }
}

struct NextEventWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RegisNext", provider: RegisProvider()) { entry in
            NextEventView(entry: entry).foregroundStyle(.white).regisBackground()
        }
        .configurationDisplayName("Next up")
        .description("Your next calendar events.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

// MARK: - Tasks

struct TasksView: View {
    @Environment(\.widgetFamily) var family
    let entry: RegisEntry
    var body: some View {
        let limit = family == .systemLarge ? 8 : family == .accessoryRectangular ? 2 : 4
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text("TO DO").font(.caption2.weight(.bold)).foregroundStyle(regisAccent).tracking(1.5)
                Spacer()
                Text("\(entry.snap.todoCount)").font(.caption.weight(.bold))
            }
            if entry.snap.todos.isEmpty { Text("All clear").font(.headline) }
            ForEach(Array(entry.snap.todos.prefix(limit))) { t in
                HStack(spacing: 6) {
                    Image(systemName: "circle").font(.caption).foregroundStyle(t.overdue == true ? .orange : regisAccent)
                    Text(t.title).font(.subheadline).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if let n = entry.staleNote { Text(n).font(.caption2).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(URL(string: "regis://open"))
    }
}

struct TasksWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RegisTasks", provider: RegisProvider()) { entry in
            TasksView(entry: entry).foregroundStyle(.white).regisBackground()
        }
        .configurationDisplayName("To-dos")
        .description("What's due today and overdue.")
        .supportedFamilies([.systemMedium, .systemLarge, .accessoryRectangular])
    }
}

// MARK: - Overview (counts)

struct OverviewView: View {
    @Environment(\.widgetFamily) var family
    let entry: RegisEntry
    var body: some View {
        switch family {
        case .accessoryCircular:
            VStack { Text("\(entry.snap.todoCount)").font(.title2.bold()); Text("to do").font(.caption2) }
        case .accessoryInline:
            Text("\(entry.snap.todoCount) to do" + (entry.snap.unread.map { " · \($0) unread" } ?? ""))
        default:
            VStack(alignment: .leading, spacing: 8) {
                Text("REGIS").font(.caption2.weight(.bold)).foregroundStyle(regisAccent).tracking(1.5)
                HStack(alignment: .firstTextBaseline) { Text("\(entry.snap.todoCount)").font(.largeTitle.bold()); Text("to do").font(.subheadline).foregroundStyle(.secondary) }
                if let u = entry.snap.unread { HStack(alignment: .firstTextBaseline) { Text("\(u)").font(.title2.bold()); Text("unread").font(.subheadline).foregroundStyle(.secondary) } }
                Spacer(minLength: 0)
                if let n = entry.staleNote { Text(n).font(.caption2).foregroundStyle(.secondary) }
            }.frame(maxWidth: .infinity, alignment: .leading).widgetURL(URL(string: "regis://open"))
        }
    }
}

struct OverviewWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RegisOverview", provider: RegisProvider()) { entry in
            OverviewView(entry: entry).foregroundStyle(.white).regisBackground()
        }
        .configurationDisplayName("At a glance")
        .description("To-do and unread counts.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryInline])
    }
}

@main
struct RegisWidgets: WidgetBundle {
    var body: some Widget {
        NextEventWidget()
        TasksWidget()
        OverviewWidget()
    }
}
