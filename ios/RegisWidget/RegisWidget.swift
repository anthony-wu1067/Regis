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

let regisAccent = Color(red: 0.72, green: 0.62, blue: 1.0)
let regisAmber = Color(red: 1.0, green: 0.78, blue: 0.47)
let regisPink = Color(red: 1.0, green: 0.62, blue: 0.80)

/// Deep violet base with two soft glows, like the app's home screen.
struct RegisBackdrop: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.13, green: 0.09, blue: 0.27), Color(red: 0.03, green: 0.03, blue: 0.08)], startPoint: .topLeading, endPoint: .bottomTrailing)
            RadialGradient(colors: [regisAccent.opacity(0.30), Color.clear], center: .topTrailing, startRadius: 2, endRadius: 170)
            RadialGradient(colors: [regisPink.opacity(0.14), Color.clear], center: .bottomLeading, startRadius: 2, endRadius: 150)
        }
    }
}

/// Two small corner brackets, the same mark the app puts on its cards.
struct Brackets: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        let l: CGFloat = 11
        p.move(to: CGPoint(x: r.minX, y: r.minY + l))
        p.addLine(to: CGPoint(x: r.minX, y: r.minY))
        p.addLine(to: CGPoint(x: r.minX + l, y: r.minY))
        p.move(to: CGPoint(x: r.maxX - l, y: r.maxY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - l))
        return p
    }
}

/// A thin progress ring.
struct RegisRing: View {
    var progress: Double
    var lineWidth: CGFloat = 5
    var color: Color = regisAccent
    var body: some View {
        let t: CGFloat = CGFloat(max(0.001, min(1.0, progress)))
        ZStack {
            Circle().stroke(Color.white.opacity(0.12), lineWidth: lineWidth)
            Circle().trim(from: 0, to: t)
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
    }
}

func regisTitleLabel(_ s: String) -> some View {
    Text(s).font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundStyle(regisAccent).tracking(2)
}

extension View {
    /// iOS 17 requires containerBackground; iOS 16 uses a plain background.
    @ViewBuilder func regisBackground() -> some View {
        if #available(iOS 17.0, *) { self.containerBackground(for: .widget) { RegisBackdrop() } }
        else { self.padding().background(RegisBackdrop()) }
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
                    regisTitleLabel("NEXT UP")
                    if evs.isEmpty {
                        Text("Nothing else on the calendar").font(.headline)
                    } else {
                        ForEach(Array(evs.prefix(family == .systemSmall ? 1 : 3))) { e in
                            VStack(alignment: .leading, spacing: 1) {
                                if family == .systemSmall, let s = e.startDate { Text(s, style: .relative).font(.system(.title3, design: .rounded).weight(.bold)).foregroundStyle(regisAmber).monospacedDigit() }
                                EventRow(e: e)
                                if family == .systemSmall, let l = e.loc, !l.isEmpty { Text(l).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                            }
                        }
                    }
                    Spacer(minLength: 0)
                    if let n = entry.staleNote { Text(n).font(.caption2).foregroundStyle(.secondary) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(Brackets().stroke(regisAccent.opacity(0.5), lineWidth: 1.2).padding(-4))
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
                regisTitleLabel("TO DO")
                Spacer()
                Text("\(entry.snap.todoCount)").font(.system(.caption, design: .monospaced).weight(.bold)).foregroundStyle(regisAmber)
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
        .overlay(Brackets().stroke(regisAccent.opacity(0.5), lineWidth: 1.2).padding(-4))
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
                regisTitleLabel("REGIS")
                HStack(spacing: 12) {
                    ZStack {
                        RegisRing(progress: Double(entry.snap.todoCount) / 10.0, lineWidth: 6, color: regisAmber)
                        Text("\(entry.snap.todoCount)").font(.system(.title2, design: .rounded).weight(.bold)).monospacedDigit()
                    }
                    .frame(width: 58, height: 58)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("to do").font(.subheadline.weight(.semibold))
                        if let u = entry.snap.unread { Text("\(u) unread").font(.caption).foregroundStyle(.secondary) }
                    }
                }
                Spacer(minLength: 0)
                if let n = entry.staleNote { Text(n).font(.caption2).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(Brackets().stroke(regisAccent.opacity(0.5), lineWidth: 1.2).padding(-4))
            .widgetURL(URL(string: "regis://open"))
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

// MARK: - Day dial

/// A 24-hour ring: today's events as amber arcs, the part of the day already gone as a violet arc, the time in the middle.
struct DayDialView: View {
    @Environment(\.widgetFamily) var family
    let entry: RegisEntry

    func fraction(_ d: Date, _ dayStart: Date) -> CGFloat {
        let f: Double = d.timeIntervalSince(dayStart) / 86400.0
        return CGFloat(max(0.0, min(1.0, f)))
    }

    var dial: some View {
        let dayStart: Date = Calendar.current.startOfDay(for: entry.date)
        let timed: [RegisSnapshot.Event] = entry.snap.events.filter { $0.allDay != true }
        return ZStack {
            Circle().stroke(Color.white.opacity(0.10), lineWidth: 9)
            ForEach(timed) { e in
                if let s = e.startDate, let en = e.endDate {
                    Circle()
                        .trim(from: fraction(s, dayStart), to: max(fraction(s, dayStart) + 0.006, fraction(en, dayStart)))
                        .stroke(regisAmber, style: StrokeStyle(lineWidth: 9, lineCap: .butt))
                        .rotationEffect(.degrees(-90))
                }
            }
            Circle().trim(from: 0, to: max(0.002, fraction(entry.date, dayStart)))
                .stroke(regisAccent, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .padding(9)
            VStack(spacing: 1) {
                Text(entry.date, style: .time)
                    .font(.system(size: 22, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text(entry.date, format: .dateTime.weekday(.abbreviated).month(.abbreviated).day())
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            .padding(18)
        }
    }

    var body: some View {
        let evs: [RegisSnapshot.Event] = entry.upcoming
        Group {
            if family == .systemMedium {
                HStack(spacing: 14) {
                    dial.frame(width: 118, height: 118)
                    VStack(alignment: .leading, spacing: 6) {
                        regisTitleLabel("TODAY")
                        if evs.isEmpty { Text("Nothing else on the calendar").font(.subheadline) }
                        ForEach(Array(evs.prefix(3))) { e in EventRow(e: e) }
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                dial
            }
        }
        .widgetURL(URL(string: "regis://open"))
    }
}

struct DayDialWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RegisDial", provider: RegisProvider()) { entry in
            DayDialView(entry: entry).foregroundStyle(.white).regisBackground()
        }
        .configurationDisplayName("Day dial")
        .description("Your day on a 24-hour ring.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct RegisWidgets: WidgetBundle {
    var body: some Widget {
        NextEventWidget()
        TasksWidget()
        OverviewWidget()
        DayDialWidget()
    }
}
