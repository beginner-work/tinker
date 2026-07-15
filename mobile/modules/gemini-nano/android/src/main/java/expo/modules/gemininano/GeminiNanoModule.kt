package expo.modules.gemininano

// Gemini Nano via ML Kit's GenAI Prompt API.
//
// API surface follows the beta docs
// (https://developers.google.com/ml-kit/genai/prompt/android/get-started):
//   Generation.getClient()           → GenerativeModel
//   model.checkStatus()              → FeatureStatus (AVAILABLE / DOWNLOADABLE / …)
//   model.download().collect { … }   → model fetch progress
//   model.generateContent(request)   → GenerateContentResponse
// The artifact is beta — if a Play-services update renames a symbol,
// this file is the only place to touch; the JS surface stays fixed.

import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.generateContentRequest
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class GeminiNanoModule : Module() {
  private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
  private val model by lazy { Generation.getClient() }

  private fun statusName(status: Int): String = when (status) {
    FeatureStatus.AVAILABLE -> "available"
    FeatureStatus.DOWNLOADABLE -> "downloadable"
    FeatureStatus.DOWNLOADING -> "downloading"
    else -> "unavailable"
  }

  override fun definition() = ModuleDefinition {
    Name("GeminiNano")

    AsyncFunction("getAvailability") { promise: Promise ->
      scope.launch {
        try {
          promise.resolve(statusName(model.checkStatus()))
        } catch (e: Throwable) {
          // AICore missing entirely (old device, no Play services).
          promise.resolve("unavailable")
        }
      }
    }

    AsyncFunction("downloadModel") { promise: Promise ->
      scope.launch {
        try {
          if (model.checkStatus() == FeatureStatus.DOWNLOADABLE) {
            model.download().collect { /* progress ignored; JS polls availability */ }
          }
          promise.resolve(statusName(model.checkStatus()))
        } catch (e: Throwable) {
          promise.reject(CodedException("ERR_NANO_DOWNLOAD", e.message, e))
        }
      }
    }

    AsyncFunction("generate") { prompt: String, maxOutputTokens: Int, temperature: Double, promise: Promise ->
      scope.launch {
        try {
          val response = model.generateContent(
            generateContentRequest(prompt) {
              this.temperature = temperature.toFloat()
              this.maxOutputTokens = maxOutputTokens
            },
          )
          promise.resolve(response.text ?: "")
        } catch (e: Throwable) {
          promise.reject(CodedException("ERR_NANO_GENERATE", e.message, e))
        }
      }
    }

    OnDestroy {
      scope.cancel()
    }
  }
}
