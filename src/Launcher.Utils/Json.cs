using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Launcher.Utils;

/// <summary>
/// JSON serialization helpers with a shared, trimmed <see cref="JsonSerializerOptions"/>.
/// </summary>
public static class Json
{
    /// <summary>Options used to persist launcher data.</summary>
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() }
    };

    /// <summary>Options used to parse Mojang / third-party API payloads.</summary>
    public static readonly JsonSerializerOptions ApiOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    /// <summary>Serializes an object to a JSON string.</summary>
    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);

    /// <summary>Deserializes a JSON string.</summary>
    public static T? Deserialize<T>(string json) => JsonSerializer.Deserialize<T>(json, Options);

    /// <summary>Deserializes a JSON string with API (web) options.</summary>
    public static T? DeserializeApi<T>(string json) => JsonSerializer.Deserialize<T>(json, ApiOptions);

    /// <summary>Serializes an object with API (web) options.</summary>
    public static string SerializeApi<T>(T value) => JsonSerializer.Serialize(value, ApiOptions);

    /// <summary>Writes an object to a file atomically.</summary>
    public static void WriteToFile<T>(string path, T value)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, Serialize(value), Encoding.UTF8);
        File.Move(tmp, path, overwrite: true);
    }

    /// <summary>Reads and deserializes a JSON file, returning null when missing/corrupt.</summary>
    public static T? ReadFromFile<T>(string path)
    {
        try
        {
            if (!File.Exists(path)) return default;
            return Deserialize<T>(File.ReadAllText(path));
        }
        catch
        {
            return default;
        }
    }
}

/// <summary>Hashing helpers (SHA1 and SHA256).</summary>
public static class Hash
{
    /// <summary>Computes the SHA1 hex digest of a file.</summary>
    public static async Task<string> Sha1OfFileAsync(string path, CancellationToken ct = default)
    {
        using var sha = SHA1.Create();
        await using var fs = File.OpenRead(path);
        var bytes = await sha.ComputeHashAsync(fs, ct);
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    /// <summary>Computes the SHA256 hex digest of a file.</summary>
    public static async Task<string> Sha256OfFileAsync(string path, CancellationToken ct = default)
    {
        using var sha = SHA256.Create();
        await using var fs = File.OpenRead(path);
        var bytes = await sha.ComputeHashAsync(fs, ct);
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    /// <summary>Computes the SHA512 hex digest of a file.</summary>
    public static async Task<string> Sha512OfFileAsync(string path, CancellationToken ct = default)
    {
        using var sha = SHA512.Create();
        await using var fs = File.OpenRead(path);
        var bytes = await sha.ComputeHashAsync(fs, ct);
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    /// <summary>Computes the SHA256 hex digest of a byte array.</summary>
    public static string Sha256(byte[] data)
    {
        var bytes = SHA256.HashData(data);
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
