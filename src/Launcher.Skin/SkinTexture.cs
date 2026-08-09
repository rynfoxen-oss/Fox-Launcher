namespace Launcher.Skin;

/// <summary>Decoded skin texture pixels in 32-bit BGRA order (the format WPF
/// rasterizes natively). Exposes helpers used for slim-model detection and for
/// deriving a slim fallback skin.</summary>
public sealed class SkinTexture
{
    public SkinTexture(int width, int height, byte[] pixels)
    {
        if (width <= 0 || height <= 0)
            throw new ArgumentOutOfRangeException(nameof(width), "Skin dimensions must be positive.");
        if (pixels.Length != width * height * 4)
            throw new ArgumentException("Pixel buffer size does not match the declared dimensions.", nameof(pixels));

        Width = width;
        Height = height;
        Pixels = pixels;
    }

    /// <summary>Texture width in pixels (64, 128, ...).</summary>
    public int Width { get; }

    /// <summary>Texture height in pixels.</summary>
    public int Height { get; }

    /// <summary>BGRA pixel data, tightly packed, row-major.</summary>
    public byte[] Pixels { get; }

    /// <summary>True when the pixel at (x, y) is fully opaque.</summary>
    public bool IsOpaque(int x, int y)
    {
        if (x < 0 || y < 0 || x >= Width || y >= Height) return false;
        return Pixels[(y * Width + x) * 4 + 3] == 0xFF;
    }

    /// <summary>True when the pixel at (x, y) is fully transparent.</summary>
    public bool IsTransparent(int x, int y)
    {
        if (x < 0 || y < 0 || x >= Width || y >= Height) return true;
        return Pixels[(y * Width + x) * 4 + 3] == 0;
    }

    /// <summary>
    /// Creates a slim (Alex-style) skin by cropping the four-pixel-wide arm
    /// regions of a classic skin down to three pixels, following the standard
    /// Minecraft 64x64 layout. Used to build the built-in Alex fallback.
    /// </summary>
    public SkinTexture ToSlim()
    {
        var dst = (byte[])Pixels.Clone();
        int s = Width >= 128 ? 2 : 1;
        var arms = new (int X, int Y)[]
        {
            // Right arm (top half of the sheet): 44,48,52,56 columns.
            (44 * s, 16 * s), // top
            (44 * s, 20 * s), // outer side
            (44 * s, 24 * s), // bottom
            (48 * s, 20 * s), // front
            (52 * s, 20 * s), // inner side
            (56 * s, 20 * s), // back
            // Left arm (bottom half of the sheet): 36,40,44,48 columns.
            (36 * s, 48 * s), // top
            (36 * s, 52 * s), // outer side
            (36 * s, 52 * s), // bottom
            (40 * s, 52 * s), // front
            (44 * s, 52 * s), // inner side
            (48 * s, 52 * s), // back
        };
        foreach (var (x, y) in arms)
        {
            // Remove the inner (right-most) pixel column of each 4-wide region.
            for (int row = 0; row < 12 * s; row++)
            {
                for (int c = 0; c < s; c++)
                {
                    int src = ((y + row) * Width + x + 3 * s + c) * 4;
                    dst[src] = 0;
                    dst[src + 1] = 0;
                    dst[src + 2] = 0;
                    dst[src + 3] = 0;
                }
            }
        }
        return new SkinTexture(Width, Height, dst);
    }
}
