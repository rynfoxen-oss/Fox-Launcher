using System.Collections.ObjectModel;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>A single tappable search result.</summary>
public sealed class SearchResult
{
    public string Title { get; init; } = "";
    public string Subtitle { get; init; } = "";
    public string Glyph { get; init; } = "";
    public string Category { get; init; } = "";
    public Action? Open { get; init; }
}

/// <summary>
/// Global search overlay: searches launcher pages, instances and the mods of the
/// selected instance. Keyboard-friendly (arrows + Enter) and opened with
/// Ctrl+F / Ctrl+K.
/// </summary>
public sealed class SearchViewModel : ViewModelBase
{
    private const int MaxResults = 24;

    private string _query = "";
    private int _selectedIndex;
    private bool _isOpen;

    public SearchViewModel(ServiceHub services) : base(services)
    {
        OpenCommand = new RelayCommand(Open);
        CloseCommand = new RelayCommand(Close);
    }

    public RelayCommand OpenCommand { get; }
    public RelayCommand CloseCommand { get; }

    public ObservableCollection<SearchResult> Results { get; } = new();

    public bool IsOpen
    {
        get => _isOpen;
        set => SetProperty(ref _isOpen, value);
    }

    public string Query
    {
        get => _query;
        set
        {
            if (SetProperty(ref _query, value))
            {
                SelectedIndex = 0;
                Refresh();
            }
        }
    }

    public int SelectedIndex
    {
        get => _selectedIndex;
        set
        {
            var clamped = Math.Clamp(value, 0, Math.Max(0, Results.Count - 1));
            if (_selectedIndex != clamped)
            {
                _selectedIndex = clamped;
                OnPropertyChanged();
            }
        }
    }

    public void Open()
    {
        Query = "";
        Results.Clear();
        IsOpen = true;
    }

    public void Close() => IsOpen = false;

    public void MoveSelection(int delta) => SelectedIndex += delta;

    /// <summary>Activates the highlighted result (Enter in the overlay).</summary>
    public void ActivateSelection()
    {
        if (Results.Count == 0) return;
        var index = Math.Clamp(SelectedIndex, 0, Results.Count - 1);
        Close();
        Results[index].Open?.Invoke();
    }

    private void Refresh()
    {
        var q = Query?.Trim().ToLowerInvariant() ?? "";
        var results = new List<SearchResult>();

        if (q.Length == 0)
        {
            Results.Clear();
            return;
        }

        try
        {
            var main = Services.Container.Resolve<MainViewModel>();

            // Pages.
            foreach (var page in main.Pages)
            {
                if (Contains(page.Title, q))
                {
                    results.Add(new SearchResult
                    {
                        Title = page.Title,
                        Subtitle = "Go to page",
                        Glyph = "\uE8FD",
                        Category = "Pages",
                        Open = () => main.Navigate(page)
                    });
                }
            }

            // Instances.
            foreach (var instance in Services.Instances.Instances)
            {
                if (results.Count >= MaxResults) break;
                if (Contains(instance.Name, q) || Contains(instance.DisplayTitle, q))
                {
                    results.Add(new SearchResult
                    {
                        Title = instance.Name,
                        Subtitle = instance.DisplayTitle,
                        Glyph = "\uE80B",
                        Category = "Instances",
                        Open = () =>
                        {
                            main.SelectedInstance = instance;
                            main.Navigate<InstancesViewModel>();
                        }
                    });
                }
            }

            // Mods of the selected instance (installed files, lightweight).
            if (main.SelectedInstance is { } selected && q.Length >= 2)
            {
                var mods = Services.Mods.ListMods(selected.Id);
                foreach (var mod in mods)
                {
                    if (results.Count >= MaxResults) break;
                    var title = string.IsNullOrWhiteSpace(mod.Title) ? mod.FileName : mod.Title;
                    if (Contains(title, q) || Contains(mod.ModId, q))
                    {
                        results.Add(new SearchResult
                        {
                            Title = title,
                            Subtitle = $"Mod · {selected.Name}",
                            Glyph = "\uE711",
                            Category = "Mods",
                            Open = () =>
                            {
                                main.SelectedInstance = selected;
                                main.Navigate<ModsViewModel>();
                            }
                        });
                    }
                }
            }
        }
        catch
        {
            // Search must never crash the window.
        }

        // Prefer pages, then exact-ish matches, then alphabetical.
        results = results
            .OrderBy(r => Rank(r, q))
            .Take(MaxResults)
            .ToList();

        Results.Clear();
        foreach (var result in results) Results.Add(result);
        SelectedIndex = 0;
    }

    private static bool Contains(string? haystack, string q)
        => !string.IsNullOrEmpty(haystack) && haystack.ToLowerInvariant().Contains(q, StringComparison.Ordinal);

    private static int Rank(SearchResult r, string q)
    {
        var title = r.Title.ToLowerInvariant();
        int score = r.Category switch
        {
            "Pages" => 0,
            "Instances" => 5,
            _ => 10
        };
        if (title == q) score -= 4;
        else if (title.StartsWith(q, StringComparison.Ordinal)) score -= 2;
        return score;
    }
}