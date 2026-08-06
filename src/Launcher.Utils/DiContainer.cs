namespace Launcher.Utils;

/// <summary>
/// Minimal dependency-injection container. Supports constructor injection,
/// singleton/transient lifetimes and factory registration. Kept dependency-free
/// so every project (including the installer) can use it.
/// </summary>
public sealed class DiContainer
{
    private readonly Dictionary<Type, Registration> _registrations = new();

    private sealed record Registration(Func<DiContainer, object> Factory, bool Singleton);
    private readonly Dictionary<Type, object> _singletons = new();
    private readonly Stack<Type> _building = new();

    /// <summary>Registers a concrete type as itself.</summary>
    public DiContainer Register<T>(Lifetime lifetime = Lifetime.Singleton) where T : class
        => Register(typeof(T), typeof(T), lifetime);

    /// <summary>Registers an implementation type against an interface.</summary>
    public DiContainer Register<TService, TImpl>(Lifetime lifetime = Lifetime.Singleton)
        where TService : class where TImpl : class
        => Register(typeof(TService), typeof(TImpl), lifetime);

    /// <summary>Registers a factory delegate.</summary>
    public DiContainer Register<TService>(Func<DiContainer, TService> factory, Lifetime lifetime = Lifetime.Singleton)
        where TService : class
    {
        _registrations[typeof(TService)] = new Registration(c => factory(c)!, lifetime == Lifetime.Singleton);
        return this;
    }

    /// <summary>Registers a pre-built singleton instance.</summary>
    public DiContainer RegisterInstance<TService>(TService instance) where TService : class
    {
        _registrations[typeof(TService)] = new Registration(_ => instance, true);
        _singletons[typeof(TService)] = instance;
        return this;
    }

    /// <summary>Registers an interface to a concrete type.</summary>
    public DiContainer Register(Type serviceType, Type implType, Lifetime lifetime = Lifetime.Singleton)
    {
        _registrations[serviceType] = new Registration(c => Build(c, implType), lifetime == Lifetime.Singleton);
        return this;
    }

    /// <summary>Resolves a service, building the object graph on demand.</summary>
    public TService Resolve<TService>() where TService : class => (TService)Resolve(typeof(TService));

    /// <summary>Resolves a service by type.</summary>
    public object Resolve(Type serviceType)
    {
        if (serviceType == typeof(DiContainer)) return this;

        if (_registrations.TryGetValue(serviceType, out var reg))
        {
            if (reg.Singleton)
            {
                if (!_singletons.TryGetValue(serviceType, out var existing))
                {
                    existing = BuildAndTrack(serviceType, () => reg.Factory(this));
                    _singletons[serviceType] = existing;
                }
                return existing;
            }
            return BuildAndTrack(serviceType, () => reg.Factory(this));
        }

        // Fall back to unregistered concrete construction.
        return BuildAndTrack(serviceType, () => Build(this, serviceType));
    }

    private object BuildAndTrack(Type type, Func<object> build)
    {
        if (_building.Contains(type))
        {
            var chain = string.Join(" -> ", _building.Reverse().Append(type));
            throw new InvalidOperationException(
                $"Circular dependency detected while resolving '{type.Name}'. Chain: {chain}");
        }

        _building.Push(type);
        try
        {
            return build();
        }
        finally
        {
            _building.Pop();
        }
    }

    private static object Build(DiContainer container, Type type)
    {
        var ctor = type.GetConstructors()
            .OrderByDescending(c => c.GetParameters().Length)
            .FirstOrDefault()
            ?? throw new InvalidOperationException($"No public constructor found for {type.Name}");

        var parameters = ctor.GetParameters();
        var args = new object[parameters.Length];
        for (var i = 0; i < parameters.Length; i++)
        {
            var paramType = parameters[i].ParameterType;
            args[i] = container.Resolve(paramType);
        }
        return ctor.Invoke(args);
    }

    /// <summary>Builds a tree of all registered types eagerly (fast startup, fails fast).</summary>
    public void BuildAll()
    {
        foreach (var key in _registrations.Keys.ToList())
        {
            Resolve(key);
        }
    }
}

/// <summary>Lifetime of a service registration.</summary>
public enum Lifetime
{
    /// <summary>One instance shared for the application lifetime.</summary>
    Singleton,

    /// <summary>A fresh instance per resolution.</summary>
    Transient
}
