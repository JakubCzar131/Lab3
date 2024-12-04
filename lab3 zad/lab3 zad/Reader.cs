using System;
using System.Collections.Generic;

public class Reader : Person
{
    private List<Book> PrzeczytaneKsiazki { get; set; }

    public Reader(string firstName, string lastName, int wiek)
        : base(firstName, lastName, wiek)
    {
        PrzeczytaneKsiazki = new List<Book>();
    }

    public void AddBook(Book book)
    {
        PrzeczytaneKsiazki.Add(book);
    }

    public List<Book> GetBooks() => new List<Book>(PrzeczytaneKsiazki);

    public void ViewBook()
    {
        Console.WriteLine("Przeczytane książki:");
        foreach (var book in PrzeczytaneKsiazki)
        {
            Console.WriteLine($"- {book.GetTitle()}");
        }
    }

    public override void View()
    {
        base.View();
        ViewBook();
    }
}
