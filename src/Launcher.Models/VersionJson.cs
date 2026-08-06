using System.Text.Json.Serialization;

namespace Launcher.Models;

/// <summary>
/// Mirrors the structure of a Minecraft version JSON file (e.g. 1.20.1.json).
/// Only the members required to download and launch are modelled.
/// </summary>
public sealed class VersionJson
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("type")]
    public string Type { get; set; } = "release";

    [JsonPropertyName("mainClass")]
    public string MainClass { get; set; } = "";

    [JsonPropertyName("minecraftArguments")]
    public string? MinecraftArguments { get; set; }

    [JsonPropertyName("assets")]
    public string Assets { get; set; } = "";

    [JsonPropertyName("assetIndex")]
    public AssetIndexInfo? AssetIndex { get; set; }

    [JsonPropertyName("downloads")]
    public VersionDownloads? Downloads { get; set; }

    [JsonPropertyName("arguments")]
    public VersionArguments? Arguments { get; set; }

    [JsonPropertyName("libraries")]
    public List<LibraryInfo> Libraries { get; set; } = new();

    [JsonPropertyName("logging")]
    public VersionLogging? Logging { get; set; }

    [JsonPropertyName("javaVersion")]
    public VersionJavaInfo? JavaVersion { get; set; }

    /// <summary>Optional raw launch args appended by mod loaders (e.g. Forge).</summary>
    [JsonPropertyName("forgeArguments")]
    public List<string>? ForgeArguments { get; set; }

    [JsonPropertyName("inheritsFrom")]
    public string? InheritsFrom { get; set; }

    [JsonPropertyName("jar")]
    public string? Jar { get; set; }
}

/// <summary>Asset index reference inside a version JSON.</summary>
public sealed class AssetIndexInfo
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("sha1")]
    public string Sha1 { get; set; } = "";

    [JsonPropertyName("size")]
    public long Size { get; set; }

    [JsonPropertyName("totalSize")]
    public long TotalSize { get; set; }

    [JsonPropertyName("url")]
    public string Url { get; set; } = "";
}

/// <summary>Client/server/mappings download descriptors.</summary>
public sealed class VersionDownloads
{
    [JsonPropertyName("client")]
    public FileDownload? Client { get; set; }

    [JsonPropertyName("server")]
    public FileDownload? Server { get; set; }

    [JsonPropertyName("client_mappings")]
    public FileDownload? ClientMappings { get; set; }

    [JsonPropertyName("server_mappings")]
    public FileDownload? ServerMappings { get; set; }
}

/// <summary>Generic remote file descriptor used across the version JSON.</summary>
public sealed class FileDownload
{
    [JsonPropertyName("url")]
    public string Url { get; set; } = "";

    [JsonPropertyName("sha1")]
    public string Sha1 { get; set; } = "";

    [JsonPropertyName("size")]
    public long Size { get; set; }

    /// <summary>Maven-style relative path (present on library artifacts).</summary>
    [JsonPropertyName("path")]
    public string? Path { get; set; }
}

/// <summary>Game and JVM argument lists (1.13+ format).</summary>
public sealed class VersionArguments
{
    [JsonPropertyName("game")]
    public List<object>? Game { get; set; }

    [JsonPropertyName("jvm")]
    public List<object>? Jvm { get; set; }
}

/// <summary>Logging configuration for the client.</summary>
public sealed class VersionLogging
{
    [JsonPropertyName("client")]
    public LoggingFileInfo? Client { get; set; }
}

/// <summary>Logging file descriptor.</summary>
public sealed class LoggingFileInfo
{
    [JsonPropertyName("argument")]
    public string? Argument { get; set; }

    [JsonPropertyName("file")]
    public FileDownload? File { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }
}

/// <summary>Java version requirement.</summary>
public sealed class VersionJavaInfo
{
    [JsonPropertyName("majorVersion")]
    public int MajorVersion { get; set; }
}
