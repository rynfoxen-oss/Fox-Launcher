using System.Windows.Input;

namespace Launcher.Utils;

/// <summary>
/// <see cref="ICommand"/> for asynchronous operations. Guards against
/// concurrent execution and marshals results back on the captured
/// <see cref="SynchronizationContext"/> (i.e. the UI thread).
/// </summary>
public sealed class AsyncRelayCommand : ICommand
{
    private readonly Func<object?, Task> _execute;
    private readonly Predicate<object?>? _canExecute;
    private bool _isRunning;
    private EventHandler? _canExecuteChanged;

    public AsyncRelayCommand(Func<Task> execute, Predicate<object?>? canExecute = null)
        : this(_ => execute(), canExecute)
    {
    }

    public AsyncRelayCommand(Func<object?, Task> execute, Predicate<object?>? canExecute = null)
    {
        _execute = execute ?? throw new ArgumentNullException(nameof(execute));
        _canExecute = canExecute;
    }

    public event EventHandler? CanExecuteChanged
    {
        add => _canExecuteChanged += value;
        remove => _canExecuteChanged -= value;
    }

    public bool CanExecute(object? parameter) => !_isRunning && (_canExecute?.Invoke(parameter) ?? true);

    public async void Execute(object? parameter)
    {
        if (_isRunning) return;
        _isRunning = true;
        RaiseCanExecuteChanged();
        try
        {
            await _execute(parameter);
        }
        catch (Exception ex)
        {
            GlobalExceptionHandler.Handle(ex, "async command");
        }
        finally
        {
            _isRunning = false;
            RaiseCanExecuteChanged();
        }
    }

    public void RaiseCanExecuteChanged() => _canExecuteChanged?.Invoke(this, EventArgs.Empty);
}
