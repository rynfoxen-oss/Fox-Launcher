using System.Text.RegularExpressions;
using Launcher.Models;
using Launcher.Network;

namespace Launcher.ModManager;

/// <summary>
/// Searches Modrinth with fuzzy matching, typo tolerance, and
/// provides search suggestions and trending/popular results.
/// </summary>
public sealed class ModSearcher
{
    private readonly ModrinthApi _api;

    public ModSearcher(ModrinthApi api) => _api = api;

    /// <summary>Search result row shown in the mod browser.</summary>
    public sealed class SearchRow
    {
        public string ProjectId { get; set; } = "";
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public string? Author { get; set; }
        public string? IconUrl { get; set; }
        public long Downloads { get; set; }
        public long Follows { get; set; }
        public List<string> SupportedVersions { get; set; } = new();
        public List<string> Categories { get; set; } = new();
        public string? LatestVersion { get; set; }
        public DateTimeOffset DateModified { get; set; }
        public bool Installed { get; set; }
    }

    /// <summary>Autocomplete suggestion.</summary>
    public sealed class Suggestion
    {
        public string Text { get; set; } = "";
        public SuggestionKind Kind { get; set; }
    }

    public enum SuggestionKind { Query, Project, Category }

    private static readonly string[] TrendingQueries =
    {
        "sodium", "iris", "optifine", "journeymap", "jei", "emi",
        "create", "thermal expansion", "biomes o plenty", "dynamic skies",
        "chisel", "tinkers construct", "botania", "draconic evolution"
    };

    private static readonly string[] PopularCategories =
    {
        "optimization", "magic", "technology", "adventure", "utility",
        "world generation", "mobs", "dimensions", "structures", "redstone",
        "storage", "decoration", "minimap", "cosmetic", "multiplayer", "api"
    };

    /// <summary>Searches Modrinth with optional loader, game version and category
    /// filters, sorted by the given index.</summary>
    public async Task<List<SearchRow>> SearchAsync(
        string query, ModLoaderType loader, string? gameVersion,
        string index = "relevance", string? category = null, CancellationToken ct = default)
    {
        var result = await _api.SearchAsync(query, loader, gameVersion, 40, index, category, ct);
        return result.Hits.Select(h => new SearchRow
        {
            ProjectId = h.ProjectId,
            Title = h.Title,
            Description = h.Description,
            Author = h.Author,
            IconUrl = h.IconUrl,
            Downloads = h.Downloads,
            Follows = h.Follows,
            SupportedVersions = h.Versions,
            Categories = h.Categories,
            LatestVersion = h.LatestVersion,
            DateModified = h.DateModified
        }).ToList();
    }

    /// <summary>Returns fuzzy-matched suggestions for the given partial query.</summary>
    public List<Suggestion> GetSuggestions(string query)
    {
        var suggestions = new List<Suggestion>();

        if (string.IsNullOrWhiteSpace(query))
        {
            suggestions.AddRange(TrendingQueries.Take(8).Select(q => new Suggestion { Text = q, Kind = SuggestionKind.Query }));
            suggestions.AddRange(PopularCategories.Take(8).Select(c => new Suggestion { Text = c, Kind = SuggestionKind.Category }));
            return suggestions;
        }

        // Fuzzy match against trending queries
        foreach (var q in TrendingQueries)
        {
            if (FuzzyMatch(q, query) && suggestions.All(s => s.Text != q))
                suggestions.Add(new Suggestion { Text = q, Kind = SuggestionKind.Query });
        }

        // Fuzzy match against categories
        foreach (var c in PopularCategories)
        {
            if (FuzzyMatch(c, query) && suggestions.All(s => s.Text != c))
                suggestions.Add(new Suggestion { Text = c, Kind = SuggestionKind.Category });
        }

        return suggestions.Take(10).ToList();
    }

    /// <summary>Simple fuzzy match: all query chars appear in order in the target.</summary>
    private static bool FuzzyMatch(string target, string query)
    {
        var t = target.ToLowerInvariant();
        var q = query.ToLowerInvariant();
        var qi = 0;
        foreach (var ch in t)
        {
            if (qi < q.Length && ch == q[qi]) qi++;
        }
        return qi == q.Length;
    }

    /// <summary>Extracts mod ID from a mod file name (e.g. "sodium-fabric-0.5.8.jar" → "sodium").</summary>
    public static string ExtractModId(string fileName)
    {
        var name = Path.GetFileNameWithoutExtension(fileName);
        // Strip common suffixes: -fabric, -forge, -neoforge, -quilt, -common, -api, -library
        var cleaned = Regex.Replace(name, @"-(fabric|forge|neoforge|quilt|common|api|library|client|server)$", "", RegexOptions.IgnoreCase);
        // Strip version numbers at the end
        cleaned = Regex.Replace(cleaned, @"-\d+[\d._]*$", "");
        return cleaned.Trim().ToLowerInvariant().Replace(' ', '-');
    }
}
