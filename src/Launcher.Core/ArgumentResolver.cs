using System.Text;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Core;

/// <summary>
/// Builds the complete java command line for a launch using the version JSON,
/// the selected account and the launch options. Handles both the legacy
/// <c>minecraftArguments</c> format (pre-1.13) and the structured
/// <c>arguments</c> format (1.13+).
/// </summary>
public static class ArgumentResolver
{
    /// <summary>
    /// Produces the argument list (without the java executable) to launch the game.
    /// </summary>
    public static List<string> BuildArguments(
        VersionJson version,
        string versionId,
        string gameVersion,
        Account account,
        LaunchOptions options,
        string gameDir,
        string assetsRoot,
        string nativesDir,
        string classpath)
    {
        var ctx = CreateContext(version, versionId, gameVersion, account, options, gameDir, assetsRoot, nativesDir, classpath);
        var args = new List<string>();

        // JVM arguments
        args.Add("-Xmx" + options.MaxMemoryMb + "M");
        args.Add("-Xms" + options.MinMemoryMb + "M");

        if (options.ShowFps)
        {
            args.Add("-Dfml.debug.launch=false");
        }

        if (version.Arguments?.Jvm is { } jvm)
        {
            args.AddRange(FlattenTokens(jvm).Select(t => ctx.Substitute(t)));
        }
        else
        {
            // Legacy JVM setup.
            args.Add($"-Djava.library.path={nativesDir}");
            args.Add("-cp");
            args.Add(classpath);
        }

        // Logging configuration (log4j) downloaded during install.
        if (version.Logging?.Client is { Argument.Length: > 0 } logging && ctx.Values.ContainsKey("path"))
        {
            args.Add(ctx.Substitute(logging.Argument));
        }

        // Main class
        args.Add(version.MainClass);

        // Game arguments
        if (!string.IsNullOrEmpty(version.MinecraftArguments))
        {
            // Legacy: single string with placeholders.
            foreach (var token in SplitLegacyArguments(version.MinecraftArguments))
            {
                args.Add(ctx.Substitute(token));
            }
        }
        else if (version.Arguments?.Game is { } game)
        {
            foreach (var token in FlattenTokens(game))
            {
                args.Add(ctx.Substitute(token));
            }
        }

        // Optional extras
        if (!string.IsNullOrEmpty(options.ServerIp))
        {
            args.Add("--server");
            args.Add(options.ServerIp);
            args.Add("--port");
            args.Add(options.ServerPort.ToString());
        }

        if (options.Fullscreen)
        {
            args.Add("--fullscreen");
        }

        return args;
    }

    private static LaunchContext CreateContext(
        VersionJson version, string versionId, string gameVersion, Account account, LaunchOptions options,
        string gameDir, string assetsRoot, string nativesDir, string classpath)
    {
        var ctx = new LaunchContext
        {
            Values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        };
        void Set(string key, string value) => ctx.Values[key] = value;

        Set("auth_player_name", account.Username);
        Set("auth_uuid", account.Uuid);
        Set("auth_access_token", account.AccessToken);
        Set("auth_session", account.AccessToken);
        Set("auth_xuid", account.XboxUserId);
        Set("clientid", "00000000-0000-0000-0000-000000000000");
        Set("user_type", account.Type == AccountType.Microsoft ? "msa" : "legacy");
        Set("user_properties", "{}");
        Set("version_name", versionId);
        Set("version_type", AppInfo.VersionType);
        Set("game_directory", gameDir);
        Set("assets_root", assetsRoot);
        Set("assets_index_name", ResolveAssetIndex(version, gameVersion));
        Set("game_assets", Path.Combine(assetsRoot, "virtual", "legacy"));
        Set("natives_directory", nativesDir);
        Set("launcher_name", AppInfo.Brand);
        Set("launcher_version", AppInfo.Version);
        Set("library_directory", Paths.Libraries);
        Set("classpath", classpath);
        Set("classpath_separator", Path.PathSeparator.ToString());
        Set("resolution_width", options.Width.ToString());
        Set("resolution_height", options.Height.ToString());
        Set("quickPlayPath", Path.Combine(gameDir, "quickPlay"));
        Set("quickPlaySingleplayer", "");
        Set("quickPlayMultiplayer", "");
        Set("quickPlayRealms", "");

        if (version.Logging?.Client?.Argument is not null && !string.IsNullOrEmpty(version.Id))
        {
            var logFile = Path.Combine(Paths.Versions, version.Id, $"logging-{version.Id}.xml");
            if (File.Exists(logFile)) Set("path", logFile);
        }

        return ctx;
    }

    /// <summary>Uses the version JSON's own asset index id, falling back to a
    /// heuristic for legacy versions that predate the asset index field.</summary>
    private static string ResolveAssetIndex(VersionJson version, string gameVersion)
    {
        if (version.AssetIndex is { Id.Length: > 0 } index) return index.Id;
        return gameVersion.StartsWith("1.7") || gameVersion.Contains("1.6") ? "legacy"
            : gameVersion.StartsWith("1.8") ? "1.8"
            : "5";
    }

    /// <summary>Splits legacy minecraftArguments respecting quotes.</summary>
    private static List<string> SplitLegacyArguments(string input)
    {
        var result = new List<string>();
        var sb = new StringBuilder();
        var inQuote = false;
        foreach (var ch in input)
        {
            if (ch == '"')
            {
                inQuote = !inQuote;
            }
            else if (ch == ' ' && !inQuote)
            {
                if (sb.Length > 0) { result.Add(sb.ToString()); sb.Clear(); }
            }
            else
            {
                sb.Append(ch);
            }
        }
        if (sb.Length > 0) result.Add(sb.ToString());
        return result;
    }

    /// <summary>Flattens an arguments list that may contain strings or rule-wrapped objects.
    /// Items deserialize as <see cref="System.Text.Json.JsonElement"/>, so both string and
    /// object kinds must be handled explicitly.</summary>
    private static IEnumerable<string> FlattenTokens(List<object> list)
    {
        foreach (var item in list)
        {
            switch (item)
            {
                case string s:
                    yield return s;
                    break;
                case System.Text.Json.JsonElement { ValueKind: System.Text.Json.JsonValueKind.String } str:
                    yield return str.GetString()!;
                    break;
                case System.Text.Json.JsonElement { ValueKind: System.Text.Json.JsonValueKind.Array } arr:
                    foreach (var sub in arr.EnumerateArray())
                    {
                        if (sub.ValueKind == System.Text.Json.JsonValueKind.String)
                            yield return sub.GetString()!;
                    }
                    break;
                case System.Text.Json.JsonElement { ValueKind: System.Text.Json.JsonValueKind.Object } el:
                    // {"rules":[...],"value":[...]} - include when rules pass.
                    if (!RulesPass(el)) continue;
                    var value = el.GetProperty("value");
                    if (value.ValueKind == System.Text.Json.JsonValueKind.Array)
                    {
                        foreach (var sub in value.EnumerateArray())
                        {
                            if (sub.ValueKind == System.Text.Json.JsonValueKind.String)
                                yield return sub.GetString()!;
                        }
                    }
                    else if (value.ValueKind == System.Text.Json.JsonValueKind.String)
                    {
                        yield return value.GetString()!;
                    }
                    break;
            }
        }
    }

    private static bool RulesPass(System.Text.Json.JsonElement element)
    {
        if (!element.TryGetProperty("rules", out var rules) || rules.ValueKind != System.Text.Json.JsonValueKind.Array)
            return true;

        var allowed = false;
        foreach (var rule in rules.EnumerateArray())
        {
            var action = rule.TryGetProperty("action", out var a) ? a.GetString() : "allow";
            if (!rule.TryGetProperty("os", out var os)) continue;
            var name = os.TryGetProperty("name", out var n) ? n.GetString() : null;
            var arch = os.TryGetProperty("arch", out var ar) ? ar.GetString() : null;
            var osMatches = name is null || name == "windows";
            var archMatches = arch is null || arch == (Environment.Is64BitOperatingSystem ? "x86_64" : "x86");
            if (osMatches && archMatches) allowed = action == "allow";
        }
        return allowed;
    }

    private sealed class LaunchContext
    {
        public Dictionary<string, string> Values { get; set; } = new();

        public string Substitute(string input)
        {
            if (!input.Contains("${")) return input;
            var result = input;
            foreach (var pair in Values)
            {
                result = result.Replace("${" + pair.Key + "}", pair.Value);
            }
            return result;
        }
    }
}
