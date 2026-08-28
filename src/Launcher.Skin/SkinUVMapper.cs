namespace Launcher.Skin;

/// <summary>Body part of a player model.</summary>
public enum SkinPart
{
    Head,
    Body,
    RightArm,
    LeftArm,
    RightLeg,
    LeftLeg
}

/// <summary>Texture layer of a body part: the base skin or the transparent
/// outer layer (hat / jacket / sleeves / pants).</summary>
public enum SkinLayer
{
    Base,
    Overlay
}

/// <summary>Face of a cuboid. Left/Right are relative to the character facing
/// the viewer (the character's left/right).</summary>
public enum SkinFace
{
    Front,
    Back,
    Left,
    Right,
    Top,
    Bottom
}

/// <summary>A rectangular region of the skin texture (in pixels).</summary>
public readonly record struct SkinRegion(int U, int V, int W, int H);

/// <summary>
/// Encodes Minecraft's canonical 64x64 skin layout (scaled for 128x128 skins).
/// Every cuboid face of every part maps to an exact texture region; slim arms
/// use the same regions with three-pixel-wide faces.
/// </summary>
public static class SkinUVMapper
{
    private static readonly Dictionary<(SkinPart, SkinLayer, SkinFace), SkinRegion> Regions64 = Build();

    public static SkinRegion GetRegion(SkinPart part, SkinLayer layer, SkinFace face, bool slimArms, int textureWidth)
    {
        int s = textureWidth >= 128 ? 2 : 1;
        var r = Regions64[(part, layer, face)];

        // Slim arms are 3 pixels wide: front/back/top/bottom faces lose a column.
        if (slimArms && face is SkinFace.Front or SkinFace.Back or SkinFace.Top or SkinFace.Bottom
                     && part is SkinPart.RightArm or SkinPart.LeftArm)
            return new SkinRegion(r.U, r.V, r.W - 1, r.H);

        return s == 1 ? r : new SkinRegion(r.U * s, r.V * s, r.W * s, r.H * s);
    }

    private static Dictionary<(SkinPart, SkinLayer, SkinFace), SkinRegion> Build()
    {
        var map = new Dictionary<(SkinPart, SkinLayer, SkinFace), SkinRegion>();

        // (part, layer) -> face -> (u, v, w, h) on the 64x64 template.
        void Add(SkinPart p, SkinLayer l, (SkinFace f, int u, int v, int w, int h)[] faces)
        {
            foreach (var (f, u, v, w, h) in faces) map[(p, l, f)] = new SkinRegion(u, v, w, h);
        }

        Add(SkinPart.Head, SkinLayer.Base, new[]
        {
            (SkinFace.Front, 8, 8, 8, 8),
            (SkinFace.Back, 24, 8, 8, 8),
            (SkinFace.Right, 0, 8, 8, 8),
            (SkinFace.Left, 16, 8, 8, 8),
            (SkinFace.Top, 8, 0, 8, 8),
            (SkinFace.Bottom, 16, 0, 8, 8),
        });
        Add(SkinPart.Head, SkinLayer.Overlay, new[]
        {
            (SkinFace.Front, 40, 8, 8, 8),
            (SkinFace.Back, 56, 8, 8, 8),
            (SkinFace.Right, 32, 8, 8, 8),
            (SkinFace.Left, 48, 8, 8, 8),
            (SkinFace.Top, 40, 0, 8, 8),
            (SkinFace.Bottom, 48, 0, 8, 8),
        });

        Add(SkinPart.Body, SkinLayer.Base, new[]
        {
            (SkinFace.Front, 20, 20, 8, 12),
            (SkinFace.Back, 32, 20, 8, 12),
            (SkinFace.Right, 16, 20, 4, 12),
            (SkinFace.Left, 28, 20, 4, 12),
            (SkinFace.Top, 20, 16, 8, 4),
            (SkinFace.Bottom, 28, 16, 8, 4),
        });
        Add(SkinPart.Body, SkinLayer.Overlay, new[]
        {
            (SkinFace.Front, 20, 36, 8, 12),
            (SkinFace.Back, 32, 36, 8, 12),
            (SkinFace.Right, 16, 36, 4, 12),
            (SkinFace.Left, 28, 36, 4, 12),
            (SkinFace.Top, 20, 32, 8, 4),
            (SkinFace.Bottom, 28, 32, 8, 4),
        });

        Add(SkinPart.RightArm, SkinLayer.Base, new[]
        {
            (SkinFace.Front, 48, 20, 4, 12),
            (SkinFace.Back, 56, 20, 4, 12),
            (SkinFace.Right, 44, 20, 4, 12),
            (SkinFace.Left, 52, 20, 4, 12),
            (SkinFace.Top, 44, 16, 4, 4),
            (SkinFace.Bottom, 44, 24, 4, 4),
        });
        Add(SkinPart.RightArm, SkinLayer.Overlay, new[]
        {
            (SkinFace.Front, 48, 36, 4, 12),
            (SkinFace.Back, 56, 36, 4, 12),
            (SkinFace.Right, 44, 36, 4, 12),
            (SkinFace.Left, 52, 36, 4, 12),
            (SkinFace.Top, 44, 32, 4, 4),
            (SkinFace.Bottom, 44, 40, 4, 4),
        });

        Add(SkinPart.LeftArm, SkinLayer.Base, new[]
        {
            (SkinFace.Front, 40, 20, 4, 12),
            (SkinFace.Back, 48, 20, 4, 12),
            (SkinFace.Right, 36, 20, 4, 12),
            (SkinFace.Left, 44, 20, 4, 12),
            (SkinFace.Top, 36, 16, 4, 4),
            (SkinFace.Bottom, 36, 24, 4, 4),
        });
        Add(SkinPart.LeftArm, SkinLayer.Overlay, new[]
        {
            (SkinFace.Front, 40, 36, 4, 12),
            (SkinFace.Back, 48, 36, 4, 12),
            (SkinFace.Right, 36, 36, 4, 12),
            (SkinFace.Left, 44, 36, 4, 12),
            (SkinFace.Top, 36, 32, 4, 4),
            (SkinFace.Bottom, 36, 40, 4, 4),
        });

        Add(SkinPart.RightLeg, SkinLayer.Base, new[]
        {
            (SkinFace.Front, 8, 20, 4, 12),
            (SkinFace.Back, 16, 20, 4, 12),
            (SkinFace.Right, 4, 20, 4, 12),
            (SkinFace.Left, 12, 20, 4, 12),
            (SkinFace.Top, 4, 16, 4, 4),
            (SkinFace.Bottom, 4, 24, 4, 4),
        });
        Add(SkinPart.RightLeg, SkinLayer.Overlay, new[]
        {
            (SkinFace.Front, 8, 36, 4, 12),
            (SkinFace.Back, 16, 36, 4, 12),
            (SkinFace.Right, 4, 36, 4, 12),
            (SkinFace.Left, 12, 36, 4, 12),
            (SkinFace.Top, 4, 32, 4, 4),
            (SkinFace.Bottom, 4, 40, 4, 4),
        });

        // The left leg lives in the lower-left block of the 64x64 sheet
        // (x16-31, y48-63) — NOT a mirror copy of the right leg's upper region.
        Add(SkinPart.LeftLeg, SkinLayer.Base, new[]
        {
            (SkinFace.Front, 20, 52, 4, 12),
            (SkinFace.Back, 28, 52, 4, 12),
            (SkinFace.Right, 16, 52, 4, 12),
            (SkinFace.Left, 24, 52, 4, 12),
            (SkinFace.Top, 20, 48, 4, 4),
            (SkinFace.Bottom, 24, 48, 4, 4),
        });
        Add(SkinPart.LeftLeg, SkinLayer.Overlay, new[]
        {
            (SkinFace.Front, 4, 52, 4, 12),
            (SkinFace.Back, 12, 52, 4, 12),
            (SkinFace.Right, 0, 52, 4, 12),
            (SkinFace.Left, 8, 52, 4, 12),
            (SkinFace.Top, 4, 48, 4, 4),
            (SkinFace.Bottom, 8, 48, 4, 4),
        });

        return map;
    }
}
