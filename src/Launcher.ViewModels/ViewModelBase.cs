using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>Base class for all view models.</summary>
public abstract class ViewModelBase : ObservableObject
{
    /// <summary>Shared services hub.</summary>
    public ServiceHub Services { get; }

    protected ViewModelBase(ServiceHub services)
    {
        Services = services;
    }
}
