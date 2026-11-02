#include <flutter/dart_project.h>
#include <flutter/flutter_view_controller.h>
#include <windows.h>

#include "flutter_window.h"
#include "utils.h"
#include "single_instance.h"

int APIENTRY wWinMain(_In_ HINSTANCE instance, _In_opt_ HINSTANCE prev,
                      _In_ wchar_t *command_line, _In_ int show_command) {
  // Check before COM/plugins/Flutter: duplicate launches must not create another
  // engine, wallet service, auto-post timer, or login window.
  openelf::InstanceLock instance_lock;
  if (instance_lock.state() == openelf::InstanceLock::State::error) {
    ::MessageBoxW(nullptr, L"OpenElf could not acquire its startup lock. Please retry.",
                  L"OpenElf", MB_OK | MB_ICONERROR);
    return EXIT_FAILURE;
  }
  HWND existing = openelf::FindExistingWindow(
      instance_lock.state() == openelf::InstanceLock::State::secondary);
  if (instance_lock.state() == openelf::InstanceLock::State::secondary) {
    // The first process may still be starting; never race it with a second engine.
    for (int attempt = 0; existing == nullptr && attempt < 80; ++attempt) {
      ::Sleep(100);
      existing = openelf::FindExistingWindow(true);
    }
  }
  if (existing != nullptr) {
    openelf::ActivateWindow(existing);
    openelf::ForwardShareLinks(existing, GetCommandLineArguments());
    return EXIT_SUCCESS;
  }
  if (instance_lock.state() == openelf::InstanceLock::State::secondary) {
    ::MessageBoxW(nullptr, L"OpenElf is already starting. Please wait and retry.",
                  L"OpenElf", MB_OK | MB_ICONINFORMATION);
    return EXIT_SUCCESS;
  }
  // Attach to console when present (e.g., 'flutter run') or create a
  // new console when running with a debugger.
  if (!::AttachConsole(ATTACH_PARENT_PROCESS) && ::IsDebuggerPresent()) {
    CreateAndAttachConsole();
  }

  // Initialize COM, so that it is available for use in the library and/or
  // plugins.
  ::CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  flutter::DartProject project(L"data");

  std::vector<std::string> command_line_arguments =
      GetCommandLineArguments();

  project.set_dart_entrypoint_arguments(std::move(command_line_arguments));

  FlutterWindow window(project);
  Win32Window::Point origin(10, 10);
  Win32Window::Size size(1360, 800);
  if (!window.Create(L"OpenElf", origin, size)) {
    return EXIT_FAILURE;
  }
  window.SetQuitOnClose(true);
  ::SetPropW(window.GetHandle(), openelf::kInstanceWindowProperty,
             reinterpret_cast<HANDLE>(static_cast<INT_PTR>(1)));

  ::MSG msg;
  while (::GetMessage(&msg, nullptr, 0, 0)) {
    ::TranslateMessage(&msg);
    ::DispatchMessage(&msg);
  }

  ::CoUninitialize();
  return EXIT_SUCCESS;
}
