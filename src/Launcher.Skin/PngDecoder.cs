using System.IO.Compression;

namespace Launcher.Skin;

/// <summary>
/// Minimal PNG decoder that expands a (skin) PNG into BGRA pixels as a
/// <see cref="SkinTexture"/>. Supports 8-bit, non-interlaced images with color
/// types 0 (gray), 2 (RGB), 3 (palette), 4 (gray+alpha) and 6 (RGBA), including
/// tRNS transparency. Used for auto slim-model detection and texture dimensions
/// when a skin is imported into the library. Returns null when the file is not
/// a PNG this decoder understands.
/// </summary>
public static class PngDecoder
{
    private static readonly byte[] Signature = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };

    public static SkinTexture? Decode(byte[] data)
    {
        if (data is null || data.Length < Signature.Length + 8)
            return null;
        if (!data.AsSpan(0, Signature.Length).SequenceEqual(Signature))
            return null;

        int width = 0, height = 0, bitDepth = 0, colorType = 0;
        byte[] idat = Array.Empty<byte>();
        byte[]? palette = null;
        byte[]? trns = null;

        int pos = Signature.Length;
        try
        {
            while (pos + 8 <= data.Length)
            {
                int length = ReadBigEndianInt32(data, pos);
                pos += 4;
                if (length < 0 || pos + 4 + length > data.Length) return null;

                var type = System.Text.Encoding.ASCII.GetString(data, pos, 4);
                pos += 4;
                var chunk = data.AsSpan(pos, length);
                pos += length + 4; // skip the CRC

                switch (type)
                {
                    case "IHDR":
                        width = ReadBigEndianInt32(chunk, 0);
                        height = ReadBigEndianInt32(chunk, 4);
                        bitDepth = chunk[8];
                        colorType = chunk[9];
                        if (bitDepth != 8) return null;         // only 8-bit skins
                        if (chunk[12] != 0) return null;        // reject interlaced
                        break;
                    case "PLTE":
                        palette = chunk.ToArray();
                        break;
                    case "tRNS":
                        trns = chunk.ToArray();
                        break;
                    case "IDAT":
                        if (chunk.Length > 0)
                        {
                            var combined = new byte[idat.Length + chunk.Length];
                            Buffer.BlockCopy(idat, 0, combined, 0, idat.Length);
                            chunk.CopyTo(combined.AsSpan(idat.Length));
                            idat = combined;
                        }
                        break;
                    case "IEND":
                        goto done;
                }
            }
            done:

            if (width <= 0 || height <= 0) return null;
            if (width > 4096 || height > 4096) return null; // sanity check
            return Render(width, height, colorType, idat, palette, trns);
        }
        catch
        {
            return null;
        }
    }

    private static SkinTexture? Render(
        int width, int height, int colorType, byte[] idat, byte[]? palette, byte[]? trns)
    {
        int channels = colorType switch { 0 => 1, 2 => 3, 3 => 1, 4 => 2, 6 => 4, _ => -1 };
        if (channels <= 0 || idat.Length == 0) return null;

        byte[] raw;
        try
        {
            using var ms = new MemoryStream(idat);
            using var inflater = new ZLibStream(ms, CompressionMode.Decompress);
            using var outMs = new MemoryStream();
            inflater.CopyTo(outMs);
            raw = outMs.ToArray();
        }
        catch
        {
            return null;
        }

        int bpp = channels; // 8-bit
        int stride = width * bpp;
        if (raw.Length < (stride + 1) * height) return null;

        // Un-filter scanlines (in place, per the PNG spec reference filters).
        var prev = new byte[stride];
        var cur = new byte[stride];
        var unfiltered = new byte[height * stride];
        int src = 0;

        for (int y = 0; y < height; y++)
        {
            int filter = raw[src++];
            if (filter > 4 || src + stride > raw.Length) return null;
            Array.Copy(raw, src, cur, 0, stride);
            src += stride;

            for (int i = 0; i < stride; i++)
            {
                byte a = i >= bpp ? cur[i - bpp] : (byte)0;
                byte b = y > 0 ? prev[i] : (byte)0;
                byte c = i >= bpp && y > 0 ? prev[i - bpp] : (byte)0;
                cur[i] = filter switch
                {
                    0 => cur[i],
                    1 => (byte)(cur[i] + a),
                    2 => (byte)(cur[i] + b),
                    3 => (byte)(cur[i] + ((a + b) >> 1)),
                    4 => (byte)(cur[i] + Paeth(a, b, c)),
                    _ => cur[i]
                };
            }

            Array.Copy(cur, 0, unfiltered, y * stride, stride);
            Array.Copy(cur, prev, stride);
        }

        // Convert to BGRA pixels.
        var pixels = new byte[width * height * 4];
        int p = 0;
        for (int y = 0; y < height; y++)
        {
            int row = y * stride;
            for (int x = 0; x < width; x++)
            {
                int idx = row + x * bpp;
                byte r, g, b, a = 0xFF;
                switch (colorType)
                {
                    case 0:
                    {
                        byte g0 = unfiltered[idx];
                        r = g = b = g0;
                        if (trns is { Length: >= 2 } && g0 == trns[1]) a = 0;
                        break;
                    }
                    case 2:
                    {
                        r = unfiltered[idx];
                        g = unfiltered[idx + 1];
                        b = unfiltered[idx + 2];
                        if (trns is { Length: >= 6 }
                            && unfiltered[idx] == trns[1]
                            && unfiltered[idx + 1] == trns[3]
                            && unfiltered[idx + 2] == trns[5]) a = 0;
                        break;
                    }
                    case 4:
                    {
                        byte g0 = unfiltered[idx];
                        r = g = b = g0;
                        a = unfiltered[idx + 1];
                        break;
                    }
                    case 6:
                    {
                        r = unfiltered[idx];
                        g = unfiltered[idx + 1];
                        b = unfiltered[idx + 2];
                        a = unfiltered[idx + 3];
                        break;
                    }
                    case 3:
                    {
                        int pi = unfiltered[idx];
                        int baseP = pi * 3;
                        if (palette is null || baseP + 2 >= palette.Length) return null;
                        r = palette[baseP];
                        g = palette[baseP + 1];
                        b = palette[baseP + 2];
                        a = trns is not null && pi < trns.Length ? trns[pi] : (byte)0xFF;
                        break;
                    }
                    default:
                        return null;
                }

                pixels[p++] = b;
                pixels[p++] = g;
                pixels[p++] = r;
                pixels[p++] = a;
            }
        }

        return new SkinTexture(width, height, pixels);
    }

    private static int Paeth(int a, int b, int c)
    {
        int p = a + b - c;
        int pa = Math.Abs(p - a);
        int pb = Math.Abs(p - b);
        int pc = Math.Abs(p - c);
        if (pa <= pb && pa <= pc) return a;
        return pb <= pc ? b : c;
    }

    private static int ReadBigEndianInt32(ReadOnlySpan<byte> s, int offset)
        => (s[offset] << 24) | (s[offset + 1] << 16) | (s[offset + 2] << 8) | s[offset + 3];
}