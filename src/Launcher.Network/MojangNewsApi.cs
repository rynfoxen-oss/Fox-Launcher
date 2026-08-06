using System.Text.Json.Serialization;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Network;

/// <summary>
/// News feed from the official launcher content endpoint with graceful fallback
/// to an embedded sample feed when offline.
/// </summary>
public sealed class MojangNewsApi
{
    private readonly Http _http;
    private const string JavaNewsUrl = "https://launchercontent.mojang.com/v2/javaNews.json";

    public MojangNewsApi(Http http) => _http = http;

    /// <summary>Fetches the news feed (returns embedded items on failure).</summary>
    public async Task<List<NewsItem>> GetNewsAsync(CancellationToken ct = default)
    {
        try
        {
            var raw = await _http.GetStringAsync(JavaNewsUrl, ct);
            var payload = Json.DeserializeApi<JavaNewsPayload>(raw);
            if (payload?.Entries is null) return FallbackNews();
            return payload.Entries
                .Select(e => new NewsItem
                {
                    Title = e.Title ?? "Untitled",
                    Body = e.Text,
                    Category = e.Category,
                    ImageUrl = e.ImageUrl,
                    LinkUrl = e.NewsUrl,
                    PublishedAt = ParseDate(e.Date)
                })
                .ToList();
        }
        catch
        {
            return FallbackNews();
        }
    }

    private static DateTimeOffset ParseDate(string? date)
        => DateTimeOffset.TryParse(date, out var result) ? result : DateTimeOffset.UtcNow;

    private static List<NewsItem> FallbackNews() => new()
    {
        new NewsItem
        {
            Title = "Welcome to FoxLauncher",
            Body = "A modern, fast and beautiful Minecraft launcher for Windows. Create instances, manage mods, shaders and worlds, and play any version from 1.8.9 to 1.21.",
            Category = "launcher",
            PublishedAt = DateTimeOffset.UtcNow
        },
        new NewsItem
        {
            Title = "Offline mode",
            Body = "Play without a Microsoft account using a local offline profile. Great for testing and playing on offline servers.",
            Category = "feature",
            PublishedAt = DateTimeOffset.UtcNow.AddDays(-2)
        },
        new NewsItem
        {
            Title = "Mod manager",
            Body = "Search and install Fabric, Forge, NeoForge and Quilt mods straight from the launcher via Modrinth, with automatic dependency downloads.",
            Category = "feature",
            PublishedAt = DateTimeOffset.UtcNow.AddDays(-4)
        }
    };

    private sealed class JavaNewsPayload
    {
        [JsonPropertyName("entries")] public List<JavaNewsEntry>? Entries { get; set; }
    }

    private sealed class JavaNewsEntry
    {
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("text")] public string? Text { get; set; }
        [JsonPropertyName("category")] public string? Category { get; set; }
        [JsonPropertyName("imageUrl")] public string? ImageUrl { get; set; }
        [JsonPropertyName("newsUrl")] public string? NewsUrl { get; set; }
        [JsonPropertyName("date")] public string? Date { get; set; }
    }
}
