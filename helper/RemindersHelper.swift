// EventKit-backed helper for the Apple Reminders MCP server.
//
// Why this exists: the AppleScript scripting bridge to Reminders.app degrades to
// tens of seconds on large stores (a 1400-item list takes ~80s just to read).
// EventKit reads/writes the same store in milliseconds, so the MCP's RemindersManager
// shells out to this binary instead of running AppleScript.
//
// Protocol: argv[1] is a JSON object { "command": ..., ... }. The binary prints a
// single JSON object to stdout: { "ok": true, "data": ... } or { "ok": false, "error": ... }.
// Dates are passed in as explicit integer components (no locale-dependent string parsing)
// and returned as ISO 8601 local strings.

import EventKit
import Foundation

// MARK: - I/O helpers

func fail(_ message: String) -> Never {
  let payload: [String: Any] = ["ok": false, "error": message]
  if let data = try? JSONSerialization.data(withJSONObject: payload),
    let str = String(data: data, encoding: .utf8)
  {
    print(str)
  } else {
    print("{\"ok\":false,\"error\":\"serialization failed\"}")
  }
  exit(0)
}

func succeed(_ data: Any) -> Never {
  let payload: [String: Any] = ["ok": true, "data": data]
  guard let out = try? JSONSerialization.data(withJSONObject: payload),
    let str = String(data: out, encoding: .utf8)
  else {
    fail("failed to serialize result")
  }
  print(str)
  exit(0)
}

// MARK: - Date conversion

/// Builds a Date from explicit components in the current calendar (local time).
func dateFrom(_ obj: [String: Any]) -> Date? {
  var c = DateComponents()
  c.year = obj["y"] as? Int
  c.month = obj["mo"] as? Int
  c.day = obj["d"] as? Int
  let allDay = (obj["allDay"] as? Bool) ?? false
  if !allDay {
    c.hour = obj["h"] as? Int
    c.minute = obj["mi"] as? Int
  } else {
    c.hour = 0
    c.minute = 0
  }
  return Calendar.current.date(from: c)
}

/// DateComponents for an EKReminder due date. All-day omits time components.
func dueComponentsFrom(_ obj: [String: Any]) -> DateComponents {
  let allDay = (obj["allDay"] as? Bool) ?? false
  var c = DateComponents()
  c.year = obj["y"] as? Int
  c.month = obj["mo"] as? Int
  c.day = obj["d"] as? Int
  if !allDay {
    c.hour = obj["h"] as? Int
    c.minute = obj["mi"] as? Int
  }
  return c
}

let isoFormatter: DateFormatter = {
  let f = DateFormatter()
  f.locale = Locale(identifier: "en_US_POSIX")
  f.dateFormat = "yyyy-MM-dd'T'HH:mm"
  return f
}()

func isoString(from components: DateComponents?) -> String? {
  guard let comps = components, let date = Calendar.current.date(from: comps) else { return nil }
  return isoFormatter.string(from: date)
}

func isoString(from date: Date?) -> String? {
  guard let date = date else { return nil }
  return isoFormatter.string(from: date)
}

// MARK: - Store access

let store = EKEventStore()

func requestAccess() {
  let sem = DispatchSemaphore(value: 0)
  var granted = false
  var failure: String?
  let handler: (Bool, Error?) -> Void = { ok, err in
    granted = ok
    if let err = err { failure = err.localizedDescription }
    sem.signal()
  }
  if #available(macOS 14.0, *) {
    store.requestFullAccessToReminders(completion: handler)
  } else {
    store.requestAccess(to: .reminder, completion: handler)
  }
  sem.wait()
  if !granted {
    fail(
      "Reminders access not granted: \(failure ?? "denied"). Allow it in System Settings → Privacy & Security → Reminders."
    )
  }
}

func calendar(named name: String?) -> EKCalendar? {
  let cals = store.calendars(for: .reminder)
  if let name = name {
    return cals.first { $0.title == name }
  }
  return store.defaultCalendarForNewReminders()
}

func fetchAll(in calendars: [EKCalendar]?) -> [EKReminder] {
  let predicate = store.predicateForReminders(in: calendars)
  let sem = DispatchSemaphore(value: 0)
  var result: [EKReminder] = []
  store.fetchReminders(matching: predicate) { reminders in
    result = reminders ?? []
    sem.signal()
  }
  sem.wait()
  return result
}

func reminderJSON(_ r: EKReminder) -> [String: Any] {
  let remindAt = isoString(from: (r.alarms?.first { $0.absoluteDate != nil })?.absoluteDate)
  return [
    "id": r.calendarItemIdentifier,
    "name": r.title ?? "",
    "completed": r.isCompleted,
    "body": r.notes ?? NSNull(),
    "dueAt": isoString(from: r.dueDateComponents) ?? NSNull(),
    "remindAt": remindAt ?? NSNull(),
    "priority": r.priority,
    "list": r.calendar?.title ?? "",
  ]
}

func findReminder(id: String?, name: String?, list: String?) -> EKReminder {
  if let id = id {
    if let item = store.calendarItem(withIdentifier: id) as? EKReminder {
      return item
    }
    fail("Reminder not found by id")
  }
  guard let name = name else { fail("Provide id or name to locate the reminder") }
  let cals = list.flatMap { calendar(named: $0) }.map { [$0] }
  let matches = fetchAll(in: cals).filter { $0.title == name }
  if matches.isEmpty { fail("Reminder not found by name") }
  if matches.count > 1 {
    fail("Multiple reminders named \"\(name)\" — specify a list to disambiguate")
  }
  return matches[0]
}

func save(_ reminder: EKReminder) {
  do {
    try store.save(reminder, commit: true)
  } catch {
    fail("Save failed: \(error.localizedDescription)")
  }
}

// MARK: - Command dispatch

guard CommandLine.arguments.count >= 2,
  let argData = CommandLine.arguments[1].data(using: .utf8),
  let req = try? JSONSerialization.jsonObject(with: argData) as? [String: Any],
  let command = req["command"] as? String
else {
  fail("Expected a JSON object argument with a \"command\" field")
}

requestAccess()

switch command {
case "list-lists":
  succeed(store.calendars(for: .reminder).map { $0.title })

case "list-reminders":
  let listName = req["list"] as? String
  let includeCompleted = (req["includeCompleted"] as? Bool) ?? false
  var cals: [EKCalendar]? = nil
  if let listName = listName {
    guard let c = calendar(named: listName) else { fail("List \"\(listName)\" not found") }
    cals = [c]
  }
  var reminders = fetchAll(in: cals)
  if !includeCompleted { reminders = reminders.filter { !$0.isCompleted } }
  succeed(reminders.map(reminderJSON))

case "create-reminder":
  guard let title = req["title"] as? String else { fail("title is required") }
  let reminder = EKReminder(eventStore: store)
  reminder.title = title
  if let notes = req["notes"] as? String { reminder.notes = notes }
  if let priority = req["priority"] as? Int { reminder.priority = priority }
  guard let cal = calendar(named: req["list"] as? String) else {
    fail("No reminder list available (is one configured in Reminders?)")
  }
  reminder.calendar = cal

  // remindAt drives the device alert: set the due date AND attach an alarm.
  if let remind = req["remind"] as? [String: Any] {
    reminder.dueDateComponents = dueComponentsFrom(remind)
    if let alarmDate = dateFrom(remind) {
      reminder.addAlarm(EKAlarm(absoluteDate: alarmDate))
    }
  } else if let due = req["due"] as? [String: Any] {
    // dueAt alone: soft deadline, no alarm.
    reminder.dueDateComponents = dueComponentsFrom(due)
  }
  save(reminder)
  succeed(["id": reminder.calendarItemIdentifier])

case "update-reminder":
  let reminder = findReminder(
    id: req["id"] as? String, name: req["name"] as? String, list: req["list"] as? String)
  if let title = req["title"] as? String { reminder.title = title }
  if let notes = req["notes"] as? String { reminder.notes = notes }
  if let priority = req["priority"] as? Int { reminder.priority = priority }
  if let completed = req["completed"] as? Bool { reminder.isCompleted = completed }
  if let remind = req["remind"] as? [String: Any] {
    reminder.dueDateComponents = dueComponentsFrom(remind)
    reminder.alarms?.forEach { reminder.removeAlarm($0) }
    if let alarmDate = dateFrom(remind) {
      reminder.addAlarm(EKAlarm(absoluteDate: alarmDate))
    }
  } else if let due = req["due"] as? [String: Any] {
    reminder.dueDateComponents = dueComponentsFrom(due)
  }
  save(reminder)
  succeed(["id": reminder.calendarItemIdentifier])

case "complete-reminder":
  let reminder = findReminder(
    id: req["id"] as? String, name: req["name"] as? String, list: req["list"] as? String)
  reminder.isCompleted = (req["completed"] as? Bool) ?? true
  save(reminder)
  succeed(["id": reminder.calendarItemIdentifier])

case "delete-reminder":
  let reminder = findReminder(
    id: req["id"] as? String, name: req["name"] as? String, list: req["list"] as? String)
  do {
    try store.remove(reminder, commit: true)
  } catch {
    fail("Delete failed: \(error.localizedDescription)")
  }
  succeed(["deleted": true])

case "create-list":
  guard let name = req["name"] as? String else { fail("name is required") }
  let cal = EKCalendar(for: .reminder, eventStore: store)
  cal.title = name
  // Attach to the default reminders source (e.g. iCloud) so it syncs to devices.
  cal.source =
    store.defaultCalendarForNewReminders()?.source
    ?? store.sources.first { $0.sourceType == .calDAV }
    ?? store.sources.first
  do {
    try store.saveCalendar(cal, commit: true)
  } catch {
    fail("Create list failed: \(error.localizedDescription)")
  }
  succeed(["created": name])

default:
  fail("Unknown command: \(command)")
}
