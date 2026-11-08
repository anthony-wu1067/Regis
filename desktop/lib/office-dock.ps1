# Regis Office dock helper. Started by lib/office.js; reads one JSON command per line on stdin and answers one JSON line on stdout.
# It only touches Word, Excel and PowerPoint windows (by window class) and the Regis window it is given.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class RegisDock {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetLong(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetLong(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool on);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  const int GWL_STYLE = -16, GWL_EXSTYLE = -20, GWLP_HWNDPARENT = -8;
  const long WS_CAPTION = 0x00C00000, WS_THICKFRAME = 0x00040000, WS_SYSMENU = 0x00080000, WS_MINIMIZEBOX = 0x00020000, WS_MAXIMIZEBOX = 0x00010000;
  const long WS_EX_APPWINDOW = 0x00040000, WS_EX_TOOLWINDOW = 0x00000080;
  const uint SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20, SWP_NOMOVE = 0x2, SWP_NOSIZE = 0x1, SWP_SHOWWINDOW = 0x40;
  static readonly Dictionary<long, long[]> saved = new Dictionary<long, long[]>();
  static readonly HashSet<long> hid = new HashSet<long>();   // docked windows Regis hid itself (the app hides others when their file closes)
  public static string Kind(string cls) { return cls == "XLMAIN" ? "excel" : cls == "OpusApp" ? "word" : cls == "PPTFrameClass" ? "powerpoint" : null; }
  /* 1.9.0: Phone Link (iMessage from an iPhone) is the only other app this helper will touch: its WinUI window in PhoneExperienceHost */
  public static string KindOf(IntPtr h) {
    var c = new StringBuilder(64); GetClassName(h, c, 64); var k = Kind(c.ToString()); if (k != null) return k;
    if (c.ToString() != "WinUIDesktopWin32WindowClass") return null; uint pid; GetWindowThreadProcessId(h, out pid);
    try { return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName == "PhoneExperienceHost" ? "phonelink" : null; } catch { return null; } }
  public static string List() {
    var sb = new StringBuilder("["); bool first = true;
    /* a docked window that is hidden but not by Regis: the app closed its file and kept the window for later. Let it go. */
    foreach (var k in new List<long>(saved.Keys)) { var w = new IntPtr(k); if (!IsWindow(w)) { saved.Remove(k); hid.Remove(k); } else if (!IsWindowVisible(w) && !hid.Contains(k)) Forget(k); }
    EnumWindows((h, l) => {
      var k = KindOf(h);
      if (k != null && (IsWindowVisible(h) || saved.ContainsKey(h.ToInt64()))) {
        var t = new StringBuilder(512); GetWindowText(h, t, 512); uint pid; GetWindowThreadProcessId(h, out pid);
        if (!first) sb.Append(','); first = false;
        sb.Append("{\"h\":").Append(h.ToInt64()).Append(",\"k\":\"").Append(k).Append("\",\"pid\":").Append(pid)
          .Append(",\"docked\":").Append(saved.ContainsKey(h.ToInt64()) ? "true" : "false")
          .Append(",\"min\":").Append(IsIconic(h) ? "true" : "false").Append(",\"max\":").Append(IsZoomed(h) ? "true" : "false")
          .Append(",\"t\":\"").Append(Esc(t.ToString())).Append("\"}");
      }
      return true; }, IntPtr.Zero);
    return sb.Append("]").ToString();
  }
  static string Esc(string s) { var b = new StringBuilder(); foreach (var ch in s) { if (ch == '"' || ch == '\\') b.Append('\\').Append(ch); else if (ch < 32) b.Append(' '); else b.Append(ch); } return b.ToString(); }
  static bool IsOffice(IntPtr h) { return IsWindow(h) && KindOf(h) != null; }
  /* dock: no frame, owned by Regis (stays above it, minimises with it, no own taskbar button) */
  public static bool Dock(long hw, long owner) {
    var h = new IntPtr(hw); if (!IsOffice(h)) return false;
    if (!saved.ContainsKey(hw)) saved[hw] = new long[] { GetLong(h, GWL_STYLE).ToInt64(), GetLong(h, GWL_EXSTYLE).ToInt64(), GetLong(h, GWLP_HWNDPARENT).ToInt64() };
    if (IsZoomed(h) || IsIconic(h)) ShowWindow(h, 9);
    /* keep the caption: without it Office switches to its full-screen look (no title row, no ribbon, so no key tips) */
    long st = saved[hw][0] & ~(WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX);
    long ex = (saved[hw][1] & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW;
    SetLong(h, GWL_STYLE, new IntPtr(st)); SetLong(h, GWL_EXSTYLE, new IntPtr(ex)); SetLong(h, GWLP_HWNDPARENT, new IntPtr(owner));
    SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    return true;
  }
  /* undock: give the window its frame, taskbar button and freedom back */
  public static bool Undock(long hw) {
    var h = new IntPtr(hw); long[] s; if (!saved.TryGetValue(hw, out s)) return false; saved.Remove(hw); hid.Remove(hw); if (!IsWindow(h)) return false;
    SetLong(h, GWLP_HWNDPARENT, new IntPtr(s[2])); SetLong(h, GWL_STYLE, new IntPtr(s[0])); SetLong(h, GWL_EXSTYLE, new IntPtr(s[1]));
    ShowWindow(h, 0); ShowWindow(h, 5);
    SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    return true;
  }
  /* give a window its own styles back without showing it */
  static void Forget(long hw) {
    long[] s; if (!saved.TryGetValue(hw, out s)) return; saved.Remove(hw); hid.Remove(hw); var h = new IntPtr(hw);
    SetLong(h, GWLP_HWNDPARENT, new IntPtr(s[2])); SetLong(h, GWL_STYLE, new IntPtr(s[0] & ~0x10000000L)); SetLong(h, GWL_EXSTYLE, new IntPtr(s[1]));
  }
  public static void UndockAll() { foreach (var k in new List<long>(saved.Keys)) Undock(k); }
  public static bool Place(long hw, int x, int y, int w, int hh, bool show, bool focus) {
    var h = new IntPtr(hw); if (!saved.ContainsKey(hw) || !IsWindow(h)) return false;
    if (!show) { hid.Add(hw); ShowWindow(h, 0); return true; }
    hid.Remove(hw);
    if (IsZoomed(h) || IsIconic(h)) ShowWindow(h, 9);
    SetWindowPos(h, IntPtr.Zero, x, y, Math.Max(200, w), Math.Max(150, hh), SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    if (focus) Focus(h);
    return true;
  }
  /* hand the keyboard to Office: Windows only lets the foreground app do that, so borrow its input queue for a moment */
  static void Focus(IntPtr h) {
    var fg = GetForegroundWindow(); if (fg == h) return; uint p; uint ft = GetWindowThreadProcessId(fg, out p), me = GetCurrentThreadId();
    bool att = ft != 0 && ft != me && AttachThreadInput(me, ft, true);
    try { BringWindowToTop(h); SetForegroundWindow(h); } finally { if (att) AttachThreadInput(me, ft, false); }
  }
  /* windows left without a frame by a crash (our exact signature: Office class, tool window, no caption): give the frame back */
  public static int Rescue() {
    int n = 0; var found = new List<IntPtr>();
    EnumWindows((h, l) => { if (KindOf(h) != null && !saved.ContainsKey(h.ToInt64())) {
        long st = GetLong(h, GWL_STYLE).ToInt64(), ex = GetLong(h, GWL_EXSTYLE).ToInt64();
        if ((ex & WS_EX_TOOLWINDOW) != 0 && (st & WS_CAPTION) == 0) found.Add(h); } return true; }, IntPtr.Zero);
    foreach (var h in found) {
      SetLong(h, GWLP_HWNDPARENT, IntPtr.Zero);
      SetLong(h, GWL_STYLE, new IntPtr(GetLong(h, GWL_STYLE).ToInt64() | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX));
      SetLong(h, GWL_EXSTYLE, new IntPtr((GetLong(h, GWL_EXSTYLE).ToInt64() & ~WS_EX_TOOLWINDOW) | WS_EX_APPWINDOW));
      ShowWindow(h, 0); ShowWindow(h, 5); SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW); n++;
    }
    return n;
  }
  public static bool Close(long hw) { var h = new IntPtr(hw); if (!IsOffice(h)) return false; PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); return true; }
}
'@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.WriteLine('{"ready":true}'); [Console]::Out.Flush()
try {
  while ($true) {
    $line = [Console]::In.ReadLine(); if ($line -eq $null) { break }
    $r = 'null'
    try {
      $c = $line | ConvertFrom-Json
      switch ($c.op) {
        'list' { $r = [RegisDock]::List() }
        'dock' { $r = ([RegisDock]::Dock([long]$c.h, [long]$c.owner)).ToString().ToLower() }
        'undock' { $r = ([RegisDock]::Undock([long]$c.h)).ToString().ToLower() }
        'place' { $r = ([RegisDock]::Place([long]$c.h, [int]$c.x, [int]$c.y, [int]$c.w, [int]$c.hh, [bool]$c.show, [bool]$c.focus)).ToString().ToLower() }
        'rescue' { $r = [string][RegisDock]::Rescue() }
        'new' {
          $prog = @{ word = 'Word.Application'; excel = 'Excel.Application'; powerpoint = 'PowerPoint.Application' }[[string]$c.k]
          if (-not $prog) { throw 'unknown app' }
          $a = $null; try { $a = [Runtime.InteropServices.Marshal]::GetActiveObject($prog) } catch { $a = New-Object -ComObject $prog }
          switch ([string]$c.k) {
            'excel' { $a.Visible = $true; $a.UserControl = $true; [void]$a.Workbooks.Add() }
            'word' { $a.Visible = $true; [void]$a.Documents.Add() }
            'powerpoint' { [void]$a.Presentations.Add(-1); $a.Visible = -1 }
          }
          [void][Runtime.InteropServices.Marshal]::ReleaseComObject($a); $a = $null; $r = 'true'
        }
        'close' { $r = ([RegisDock]::Close([long]$c.h)).ToString().ToLower() }
        'quitIdle' {
          $prog = @{ word = 'Word.Application'; excel = 'Excel.Application'; powerpoint = 'PowerPoint.Application' }[[string]$c.k]; $r = 'false'
          $a = $null; try { $a = [Runtime.InteropServices.Marshal]::GetActiveObject($prog) } catch { }
          if ($a) {
            $n = switch ([string]$c.k) { 'excel' { $a.Workbooks.Count } 'word' { $a.Documents.Count } 'powerpoint' { $a.Presentations.Count } }
            if ($n -eq 0) { $a.Quit(); $r = 'true' }
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($a); $a = $null
          }
        }
        'bye' { [RegisDock]::UndockAll(); $r = 'true' }
      }
    } catch { $r = '{"err":"' + (($_.Exception.Message -replace '["\\]', ' ') -replace '[\r\n\t]+', ' ') + '"}' }
    [Console]::Out.WriteLine('{"id":' + [int]$c.id + ',"r":' + $r + '}'); [Console]::Out.Flush()
    if ($c.op -eq 'bye') { break }
  }
} finally { [RegisDock]::UndockAll() }
