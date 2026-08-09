namespace Launcher.Skin;

/// <summary>User-facing model selection preference. Auto prefers the account's
/// declared variant (or a pixel-based heuristic) and falls back to Classic.</summary>
public enum SkinModelPreference
{
    Auto,
    Classic,
    Slim
}
