using System.Text.Json.Serialization;

namespace Launcher.Models;

/// <summary>Minecraft asset index (assets/1.json or assets/indexes/&lt;id&gt;.json).</summary>
public sealed class AssetIndex
{
    [JsonPropertyName("objects")]
    public Dictionary<string, AssetObject> Objects { get; set; } = new();

    [JsonPropertyName("map_to_resources")]
    public bool MapToResources { get; set; }
}

/// <summary>One hashed asset object inside the index.</summary>
public sealed class AssetObject
{
    [JsonPropertyName("hash")]
    public string Hash { get; set; } = "";

    [JsonPropertyName("size")]
    public long Size { get; set; }

    /// <summary>Filesystem key, e.g. "aa/abcdef...".</summary>
    [JsonIgnore]
    public string Key => $"{Hash[..2]}/{Hash}";
}
