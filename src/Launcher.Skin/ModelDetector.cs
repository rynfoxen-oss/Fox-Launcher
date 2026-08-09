namespace Launcher.Skin;

/// <summary>
/// Detects the player model type from the skin pixels. On the canonical 64x64
/// layout the classic right arm is 4 pixels wide (its outer column x=47 is
/// opaque) while the slim arm is 3 pixels wide (x=47 is transparent). The same
/// check holds on 128x128 skins at doubled coordinates.
/// </summary>
public static class ModelDetector
{
    /// <summary>Returns the detected model type, or null when it cannot be told apart.</summary>
    public static SkinModelType? Detect(SkinTexture texture)
    {
        if (texture.Width < 64 || texture.Height < 64) return null;
        int s = texture.Width >= 128 ? 2 : 1;
        bool slim = texture.IsTransparent(47 * s, 20 * s)
                 && texture.IsTransparent(47 * s, 24 * s);
        return slim ? SkinModelType.Slim : SkinModelType.Classic;
    }
}
