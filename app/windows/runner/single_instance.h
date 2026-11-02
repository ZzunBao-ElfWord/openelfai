#ifndef RUNNER_SINGLE_INSTANCE_H_
#define RUNNER_SINGLE_INSTANCE_H_
#include <windows.h>
#include <string>
#include <vector>

namespace openelf {
inline constexpr wchar_t kInstanceMutex[] = L"Local\\OpenElf.Desktop.SingleInstance.v1";
inline constexpr wchar_t kInstanceWindowProperty[] = L"OpenElf.Desktop.PrimaryWindow.v1";

// Keep this handle alive for the entire primary process lifetime. No disk lock.
class InstanceLock final {
 public:
  enum class State { primary, secondary, error };
  explicit InstanceLock(const wchar_t* name = kInstanceMutex);
  ~InstanceLock();
  InstanceLock(const InstanceLock&) = delete;
  InstanceLock& operator=(const InstanceLock&) = delete;
  State state() const { return state_; }
 private:
  HANDLE handle_ = nullptr;
  State state_ = State::error;
};

UINT ActivationMessage();
HWND FindExistingWindow(bool ready_only = false);
void ActivateWindow(HWND window);
void ForwardShareLinks(HWND window, const std::vector<std::string>& arguments);
bool IsSupportedShareLink(const std::string& argument);
}  // namespace openelf
#endif
