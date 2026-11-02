#include "single_instance.h"
#include <cwchar>

namespace openelf {
InstanceLock::InstanceLock(const wchar_t* name) {
  handle_ = ::CreateMutexW(nullptr, FALSE, name);
  if (handle_ != nullptr) {
    state_ = ::GetLastError() == ERROR_ALREADY_EXISTS ? State::secondary : State::primary;
  }
}
InstanceLock::~InstanceLock() { if (handle_ != nullptr) ::CloseHandle(handle_); }

UINT ActivationMessage() {
  static const UINT message = ::RegisterWindowMessageW(L"OpenElf.Desktop.Activate.v1");
  return message;
}

namespace {
struct Candidates { HWND primary = nullptr; HWND legacy = nullptr; };
BOOL CALLBACK CollectWindow(HWND window, LPARAM param) {
  DWORD process_id = 0;
  ::GetWindowThreadProcessId(window, &process_id);
  if (process_id == ::GetCurrentProcessId()) return TRUE;
  wchar_t class_name[128]{};
  ::GetClassNameW(window, class_name, 128);
  if (::wcscmp(class_name, L"FLUTTER_RUNNER_WIN32_WINDOW") != 0) return TRUE;
  auto* candidates = reinterpret_cast<Candidates*>(param);
  if (::GetPropW(window, kInstanceWindowProperty) != nullptr) {
    candidates->primary = window;
    return FALSE;
  }
  // Older delivered builds do not own the mutex/property. Match their title,
  // Flutter window class AND executable name, not unrelated Flutter apps.
  wchar_t title[128]{};
  ::GetWindowTextW(window, title, 128);
  if (::wcscmp(title, L"OpenElf") != 0) return TRUE;
  HANDLE process = ::OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process_id);
  if (process == nullptr) return TRUE;
  wchar_t executable[32768]{};
  DWORD size = 32768;
  const BOOL ok = ::QueryFullProcessImageNameW(process, 0, executable, &size);
  ::CloseHandle(process);
  if (!ok) return TRUE;
  const wchar_t* slash = ::wcsrchr(executable, L'\\');
  const wchar_t* name = slash == nullptr ? executable : slash + 1;
  if (::_wcsicmp(name, L"openelf.exe") == 0 && candidates->legacy == nullptr) {
    candidates->legacy = window;
  }
  return TRUE;
}
}  // namespace

HWND FindExistingWindow(bool ready_only) {
  Candidates candidates;
  ::EnumWindows(CollectWindow, reinterpret_cast<LPARAM>(&candidates));
  if (candidates.primary != nullptr) return candidates.primary;
  // Concurrent launchers may be handing off to a legacy instance. A visible
  // legacy window has already initialized plugins; do not wait for a property
  // that old binaries will never set. New hidden startup windows are not ready.
  if (candidates.legacy != nullptr && (!ready_only || ::IsWindowVisible(candidates.legacy))) {
    return candidates.legacy;
  }
  return nullptr;
}

void ActivateWindow(HWND window) {
  if (!::IsWindow(window)) return;
  DWORD process_id = 0;
  ::GetWindowThreadProcessId(window, &process_id);
  ::AllowSetForegroundWindow(process_id);
  ::ShowWindowAsync(window, ::IsIconic(window) ? SW_RESTORE : SW_SHOW);
  if (ActivationMessage() != 0) ::PostMessageW(window, ActivationMessage(), 0, 0);
  if (!::SetForegroundWindow(window)) {
    FLASHWINFO flash{sizeof(FLASHWINFO), window, FLASHW_TRAY, 2, 0};
    ::FlashWindowEx(&flash);  // Respect foreground restrictions, never force topmost.
  }
}

bool IsSupportedShareLink(const std::string& argument) {
  return argument.size() <= 16384 && argument.find('\0') == std::string::npos &&
    (argument.rfind("https://openelfai.com/e/", 0) == 0 ||
     argument.rfind("https://openelfai.com/e?", 0) == 0);
}

void ForwardShareLinks(HWND window, const std::vector<std::string>& arguments) {
  // Existing app_links 6.x protocol expects UTF-8, null terminated, WM_USER+2.
  // Bounded delivery prevents a hung old window from blocking another launch.
  for (const auto& argument : arguments) {
    if (!IsSupportedShareLink(argument)) continue;
    COPYDATASTRUCT data{};
    data.dwData = WM_USER + 2;
    data.cbData = static_cast<DWORD>(argument.size() + 1);
    data.lpData = const_cast<char*>(argument.c_str());
    DWORD_PTR result = 0;
    ::SendMessageTimeoutW(window, WM_COPYDATA, 0, reinterpret_cast<LPARAM>(&data),
                         SMTO_ABORTIFHUNG | SMTO_BLOCK, 1000, &result);
  }
}
}  // namespace openelf
