using System;

public class Person
{
    private string FirstName { get; set; }
    private string LastName { get; set; }
    private int wiek;

    public Person(string firstName, string lastName, int wiek)
    {
        FirstName = firstName;
        LastName = lastName;
        this.wiek = wiek;
    }

    public virtual void View()
    {
        Console.WriteLine($"Imię: {FirstName}, Nazwisko: {LastName}, Wiek: {wiek}");
    }
}
