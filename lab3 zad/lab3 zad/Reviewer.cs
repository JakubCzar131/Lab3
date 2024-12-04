using System;

public class Reviewer : Reader
{
    public Reviewer(string firstName, string lastName, int wiek)
        : base(firstName, lastName, wiek)
    {
    }

    public void Wypisz()
    {
        Console.WriteLine("Recenzje książek:");
        var rand = new Random();
        foreach (var book in GetBooks())
        {
            Console.WriteLine($"- {book.GetTitle()}: Ocena {rand.Next(1, 11)}");
        }
    }
}
