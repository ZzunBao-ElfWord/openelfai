package com.openelf.app

import androidx.core.content.FileProvider

// A distinct manifest identity keeps this provider separate from the Douyin SDK
// provider. Never override the SDK's authority or file-path configuration.
class StageShareFileProvider : FileProvider()
