# Optional local PDF translation

Lumior optionally downloads the unmodified Tencent **Hy-MT2-1.8B Q4_K_M** model and an unmodified official **llama.cpp b12359** runtime. Model weights and runtime archives are not part of the normal app installation. Their upstream licenses apply independently of Lumior's license.

- Model: Tencent Hy-MT2-1.8B-GGUF, revision `a0c709d9fac510f2c807aa3af52872340dc37a4a`, Apache-2.0. The original Tencent copyright notice and license are preserved in [hy-mt2.txt](hy-mt2.txt).
- Runtime: ggml-org/llama.cpp `b12359`, commit `b1b770d90d94cad9e9ea5b993bdbc383a522fb28`, MIT. The original copyright notice and license are preserved in [llama.cpp.txt](llama.cpp.txt).
- The Windows CPU runtime includes LLVM OpenMP; its original `LICENSE-LLVM-OpenMP` from the downloaded archive is preserved in [llvm-openmp.txt](llvm-openmp.txt).

The immutable model revision, exact asset URLs, byte counts and SHA-256 checksums are recorded in `desktop/runtime/local-translation-manifest.json`. On 2026-11-16, the model size and digest were checked against the Hugging Face model API, and all three runtime archives were downloaded and verified against the official GitHub asset digests. The runtime tag is the binary build referenced by the upstream `v1.0.0` release's `nightly-tag.txt`; Lumior pins `b12359` directly and never resolves `latest` while installing.

Runtime archives retain their included license files after extraction. Additional notices shipped in future runtime builds must be preserved when updating this manifest.
