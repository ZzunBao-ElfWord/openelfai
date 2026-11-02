#include "../single_instance.h"
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {
void Check(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}
std::string received;
int deliveries = 0;
LRESULT CALLBACK TestWindow(HWND window, UINT message, WPARAM wp, LPARAM lp) {
  if (message == WM_COPYDATA) {
    const auto* data = reinterpret_cast<COPYDATASTRUCT*>(lp);
    Check(data->dwData == WM_USER + 2, "app_links message id changed");
    const auto* text = static_cast<const char*>(data->lpData);
    Check(data->cbData > 0 && text[data->cbData - 1] == '\0', "link not terminated");
    received.assign(text, data->cbData - 1); ++deliveries; return TRUE;
  }
  return ::DefWindowProcW(window, message, wp, lp);
}
void Child(const std::wstring& name) {
  openelf::InstanceLock lock(name.c_str());
  if (lock.state() != openelf::InstanceLock::State::primary) ::ExitProcess(10);
  HANDLE ready = ::OpenEventW(EVENT_MODIFY_STATE, FALSE, (name + L".ready").c_str());
  HANDLE stop = ::OpenEventW(SYNCHRONIZE, FALSE, (name + L".stop").c_str());
  if (!ready || !stop) ::ExitProcess(11);
  ::SetEvent(ready);
  ::WaitForSingleObject(stop, 10000);
  // Bypass C++ destructors to prove Windows releases the lock on process exit.
  ::ExitProcess(0);
}
}

int wmain(int argc, wchar_t** argv) {
  if (argc == 3 && std::wstring(argv[1]) == L"--hold-test-lock") Child(argv[2]);
  try {
    const auto name = L"Local\\OpenElf.SingleInstance.Test." + std::to_wstring(::GetCurrentProcessId());
    {
      openelf::InstanceLock primary(name.c_str());
      Check(primary.state() == openelf::InstanceLock::State::primary, "first instance not primary");
      openelf::InstanceLock secondary(name.c_str());
      Check(secondary.state() == openelf::InstanceLock::State::secondary, "duplicate not suppressed");
      openelf::InstanceLock third(name.c_str());
      Check(third.state() == openelf::InstanceLock::State::secondary, "third launch not suppressed");
    }
    {
      openelf::InstanceLock reopened(name.c_str());
      Check(reopened.state() == openelf::InstanceLock::State::primary, "clean close left a stale lock");
    }
    {
      openelf::InstanceLock invalid(L"invalid\\nested\\object");
      Check(invalid.state() == openelf::InstanceLock::State::error, "lock error must fail closed");
    }
    std::cout << "PASS atomic first/duplicate/third/reopen and lock failure\n";

    const std::wstring child_name = name + L".child";
    HANDLE ready = ::CreateEventW(nullptr, TRUE, FALSE, (child_name + L".ready").c_str());
    HANDLE stop = ::CreateEventW(nullptr, TRUE, FALSE, (child_name + L".stop").c_str());
    wchar_t executable[32768]{}; ::GetModuleFileNameW(nullptr, executable, 32768);
    std::wstring command = L"\"" + std::wstring(executable) + L"\" --hold-test-lock \"" + child_name + L"\"";
    STARTUPINFOW startup{}; startup.cb = sizeof(startup); PROCESS_INFORMATION process{};
    Check(::CreateProcessW(nullptr, command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
                          nullptr, nullptr, &startup, &process) != FALSE, "child fixture failed");
    Check(::WaitForSingleObject(ready, 5000) == WAIT_OBJECT_0, "child not ready");
    {
      openelf::InstanceLock secondary(child_name.c_str());
      Check(secondary.state() == openelf::InstanceLock::State::secondary, "cross-process duplicate admitted");
    }
    ::SetEvent(stop);
    Check(::WaitForSingleObject(process.hProcess, 5000) == WAIT_OBJECT_0, "child fixture not exited");
    ::CloseHandle(process.hThread); ::CloseHandle(process.hProcess); ::CloseHandle(ready); ::CloseHandle(stop);
    {
      openelf::InstanceLock after_exit(child_name.c_str());
      Check(after_exit.state() == openelf::InstanceLock::State::primary, "process exit left stale lock");
    }
    std::cout << "PASS cross-process lock and abnormal destructor-free exit recovery\n";

    Check(openelf::IsSupportedShareLink("https://openelfai.com/e/?id=fixture"), "valid share dropped");
    Check(openelf::IsSupportedShareLink("https://openelfai.com/e?id=fixture"), "root share dropped");
    for (const auto& invalid : {"https://evil.example/e/?id=x", "https://openelfai.com.evil/e/?id=x",
      "http://openelfai.com/e/?id=x", "--no-captcha", "https://openelfai.com/console/"}) {
      Check(!openelf::IsSupportedShareLink(invalid), "untrusted startup argument forwarded");
    }
    Check(!openelf::IsSupportedShareLink(std::string(20000, 'x')), "oversized argument admitted");
    WNDCLASSW wc{}; wc.lpfnWndProc = TestWindow; wc.hInstance = ::GetModuleHandleW(nullptr);
    wc.lpszClassName = L"OpenElfSingleInstanceUnitFixture"; ::RegisterClassW(&wc);
    HWND window = ::CreateWindowW(wc.lpszClassName, L"Hidden unit fixture", 0, 0, 0, 0, 0,
                                  nullptr, nullptr, wc.hInstance, nullptr);
    Check(window != nullptr, "fixture window failed");
    const std::string link = "https://openelfai.com/e/?id=fixture&name=%E6%B5%8B%E8%AF%95";
    openelf::ForwardShareLinks(window, {"--ignore", link, "https://evil.example/e/?id=x"});
    Check(deliveries == 1 && received == link, "UTF-8 app_links forwarding changed");
    ::DestroyWindow(window); ::UnregisterClassW(wc.lpszClassName, wc.hInstance);
    std::cout << "PASS bounded share-link forwarding and argument allowlist\n";
    return 0;
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
