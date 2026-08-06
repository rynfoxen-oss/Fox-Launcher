using System.Windows.Input;

namespace Launcher.Utils;

/// <summary>
/// Lightweight <see cref="ICommand"/> implementation wrapping an
/// <see cref="Action"/> or <see cref="Action{T}"/>.
/// </summary>
public sealed class RelayCommand : ICommand
{
    private readonly Action<object?> _execute;
    private readonly Predicate<object?>? _canExecute;
    private EventHandler? _canExecuteChanged;

    public RelayCommand(Action execute, Predicate<object?>? canExecute = null)
        : this(_ => execute(), canExecute)
    {
    }

    public RelayCommand(Action<object?> execute, Predicate<object?>? canExecute = null)
    {
        _execute = execute ?? throw new ArgumentNullException(nameof(execute));
        _canExecute = canExecute;
    }

    public event EventHandler? CanExecuteChanged
    {
        add => _canExecuteChanged += value;
        remove => _canExecuteChanged -= value;
    }

    public bool CanExecute(object? parameter) => _canExecute?.Invoke(parameter) ?? true;

    public void Execute(object? parameter) => _execute(parameter);

    /// <summary>Forces the UI to re-query <see cref="CanExecute"/>.</summary>
    public void RaiseCanExecuteChanged() => _canExecuteChanged?.Invoke(this, EventArgs.Empty);
}
