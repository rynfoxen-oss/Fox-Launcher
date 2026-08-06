using Launcher.Models;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>News feed page.</summary>
public sealed class NewsViewModel : ViewModelBase
{
    private IReadOnlyList<NewsItem> _items = Array.Empty<NewsItem>();
    private NewsItem? _selected;
    private bool _isLoading;

    public NewsViewModel(ServiceHub services) : base(services)
    {
        RefreshCommand = new AsyncRelayCommand(async () => await LoadAsync(force: true));
        OpenCommand = new RelayCommand(Open);
    }

    public AsyncRelayCommand RefreshCommand { get; }
    public RelayCommand OpenCommand { get; }

    public IReadOnlyList<NewsItem> Items
    {
        get => _items;
        private set => SetProperty(ref _items, value);
    }

    public NewsItem? Selected
    {
        get => _selected;
        set => SetProperty(ref _selected, value);
    }

    public bool IsLoading
    {
        get => _isLoading;
        private set => SetProperty(ref _isLoading, value);
    }

    public async Task LoadAsync(bool force = false)
    {
        IsLoading = true;
        try
        {
            Items = await Services.News.GetNewsAsync(force);
            Selected ??= Items.FirstOrDefault();
        }
        finally
        {
            IsLoading = false;
        }
    }

    private void Open()
    {
        if (Selected?.LinkUrl is not null) ProcessHelper.Open(Selected.LinkUrl);
    }
}

/// <summary>In-app log viewer page.</summary>
public sealed class LogsViewModel : ViewModelBase
{
    private IReadOnlyList<string> _lines = Array.Empty<string>();

    public LogsViewModel(ServiceHub services) : base(services)
    {
        OpenFileCommand = new RelayCommand(() => services.Log.OpenLogFile());
        services.Log.LogLine += line =>
        {
            var lines = Lines.ToList();
            lines.Add(line);
            if (lines.Count > 500) lines.RemoveRange(0, lines.Count - 500);
            Lines = lines;
        };
    }

    public RelayCommand OpenFileCommand { get; }

    public IReadOnlyList<string> Lines
    {
        get => _lines;
        private set => SetProperty(ref _lines, value);
    }
}
